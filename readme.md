# Day 24 — RAG (Retrieval Augmented Generation)
## 30-Day Web Development Learning Path

---

## What We Built

A RAG system that:
- Ingests documents into a local vector database
- Searches semantically using embeddings
- Integrates RAG as an agent tool alongside calculator, weather, and notes
- Automatically resets stale sessions when document is updated
- Retries gracefully on transient API failures

---

## Project Structure

```
day24/
├── config.js             ← constants including DOCUMENT_VERSION
├── server.js             ← Express API with session versioning
├── agent.js              ← agent loop with RAG tool added
├── ingest.js             ← Phase 1: read, chunk, embed, store
├── query.js              ← Phase 2: standalone query script
├── document.txt          ← source knowledge base
│
├── tools/
│   ├── calculator.js
│   ├── weather.js
│   ├── notes.js
│   └── rag.js            ← RAG as an agent tool
│
├── vector-db/            ← local vector database (gitignore this)
├── logs/
└── .env
```

---

## Two Phase Architecture

RAG is always split into two completely separate phases:

```
PHASE 1 — INGESTION (run once, or when document changes)
─────────────────────────────────────────────────────────
document.txt
    ↓
Read full text
    ↓
Split into chunks (chunkText)
    ↓
Generate embedding for each chunk (getEmbedding)
    ↓
Store in vector-db/

Run with: node ingest.js
Users CANNOT query until this is complete.

PHASE 2 — QUERYING (runs on every user question)
─────────────────────────────────────────────────
User question
    ↓
Generate embedding for question
    ↓
Search vector-db/ for similar chunks
    ↓
Filter by minimum score (0.3)
    ↓
Inject relevant chunks into model prompt
    ↓
Model answers using your data

Runs automatically via agent tool call.
```

**Why separated?** Embedding is slow and expensive. Ingestion is a one-time cost. Querying must be fast for real-time user responses.

---

## Core Concepts

### 1. Embeddings — Text as Numbers

Embeddings convert text into an array of numbers that capture **meaning**:

```javascript
"refund policy"  →  [0.2, 0.8, 0.1, 0.5, ...]  // 384 numbers
"money back"     →  [0.3, 0.7, 0.2, 0.4, ...]  // similar numbers = similar meaning
"weather today"  →  [0.9, 0.1, 0.8, 0.2, ...]  // different numbers = different meaning
```

Key properties:
- Same model must be used for both ingestion and querying — different models produce incompatible number spaces
- Similar meaning = similar numbers = high similarity score
- `normalize: true` is required for accurate similarity search

```javascript
// Always use identical settings in both ingest.js and query.js
const output = await pipe(text, {
    pooling: "mean",    // average all token embeddings into one vector
    normalize: true     // normalize to unit length — required for similarity search
});
```

---

### 2. Chunking — Splitting Documents

Documents are split into smaller pieces so relevant sections can be retrieved independently:

```javascript
function chunkText(text, chunkSize = 50, overlap = 10) {
    const words = text.split(" ");
    const chunks = [];
    let i = 0;

    while (i < words.length) {
        const chunk = words.slice(i, i + chunkSize).join(" ");
        chunks.push(chunk);
        i += chunkSize - overlap; // overlap prevents losing context at boundaries
    }

    return chunks;
}
```

**Overlap explained:**
```
Chunk 1: "We offer a 30 day money back guarantee contact support"
Chunk 2: "contact support@company.com refunds processed within 7 days"
          ↑ shared words ensure context isn't lost at boundaries
```

**Chunk size tradeoffs:**

| Chunk Size | Pro | Con |
|------------|-----|-----|
| Too small | Precise retrieval | Loses context |
| Too large | More context | Less precise retrieval |
| 50-200 words | Balance | Good starting point |

---

### 3. Vector Database — Storing Embeddings

Vectra stores embeddings locally as files — no cloud setup needed:

```javascript
const index = new LocalIndex("./vector-db");

// Create database
if (!await index.isIndexCreated()) {
    await index.createIndex();
}

// Store chunk with its embedding
await index.insertItem({
    vector: embedding,                      // the numbers
    metadata: { text: chunk, index: i }    // original text kept alongside
});

// Search for similar chunks
const results = await index.queryItems(questionEmbedding, 2); // top 2 results
```

---

### 4. Similarity Score

Every search result has a score between 0 and 1:

```
0.0  = completely unrelated
0.3  = minimum useful relevance (filter below this)
0.5  = somewhat relevant
0.8+ = highly relevant
1.0  = identical meaning
```

Always filter by minimum score to prevent hallucination from weakly related chunks:

```javascript
const relevantChunks = results
    .filter(result => result.score > 0.3)  // ignore low relevance results
    .map(result => result.item.metadata.text);

if (relevantChunks.length === 0) {
    return "No relevant information found in the document.";
}
```

---

### 5. Context Injection

Retrieved chunks are injected into the model prompt — this is what makes RAG work:

```javascript
const context = relevantChunks
    .map(c => c.text)   // extract text from each chunk
    .join("\n\n");       // join into one string with blank line between chunks

// Inject into prompt
{
    role: "user",
    content: `Context:\n${context}\n\nQuestion: ${question}`
}
```

The model is instructed to answer only from the provided context:
```javascript
{
    role: "system",
    content: "Answer questions based only on the provided context. If the answer is not in the context, say so clearly."
}
```

---

### 6. Document Versioning — Keeping Sessions Fresh

Problem: when you update your document and re-ingest, existing sessions remember old failed searches and don't retry.

Solution: track document version in each session. When version changes, session auto-resets:

```javascript
// config.js — bump this every time you re-ingest
export const DOCUMENT_VERSION = 1;

// server.js — check version on every request
if (!sessions[sessionId] || sessions[sessionId].documentVersion !== DOCUMENT_VERSION) {
    sessions[sessionId] = {
        documentVersion: DOCUMENT_VERSION,
        messages: [
            { role: "system", content: "Always use available tools to fetch fresh information. Never rely on previous failed attempts — the knowledge base may have been updated." }
        ]
    };
}

// Access messages via .messages
sessions[sessionId].messages.push({ role: "user", content: message });
```

**Workflow when updating document:**
1. Update `document.txt`
2. `rm -rf vector-db`
3. `node ingest.js`
4. Bump `DOCUMENT_VERSION` in `config.js`
5. Restart server — all sessions auto-reset on next message

---

### 7. Retry Logic with Exponential Backoff

Transient API failures (especially on free tier) are handled with automatic retries:

```javascript
async function callWithRetry(params, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await callWithFallback(params);
        } catch (error) {
            console.log(`Attempt ${attempt} failed: ${error.message}`);
            if (attempt === maxRetries) throw error;
            // wait longer between each attempt: 1s, 2s, 3s
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}
```

**Exponential backoff** — waiting progressively longer between retries:
- Attempt 1 fails → wait 1 second
- Attempt 2 fails → wait 2 seconds
- Attempt 3 fails → throw error

This is standard practice in production APIs to handle transient failures gracefully.

---

### 8. Document Type Flexibility

The RAG pipeline works with any document type — only the text extraction step changes:

```javascript
// The pipeline is always the same
const text = await extractText(document); // ← only this changes
const chunks = chunkText(text);
const embeddings = await embedChunks(chunks);
// store, search, answer — identical regardless of source
```

| Document Type | Extraction Method |
|--------------|------------------|
| `.txt` | `fs.readFileSync()` — no extraction needed |
| `.pdf` | `pdf-parse` library |
| `.docx` | `mammoth` library |
| `.csv` | `papaparse` library |
| `.json` | `JSON.parse()` built into Node |
| Website | `cheerio` or `puppeteer` |
| API response | Already JSON — just stringify |
| Audio/Video | Transcribe with Whisper first |

---

### 9. Ingestion Strategy

| Strategy | How | When to use |
|----------|-----|-------------|
| Full re-index | Delete DB, ingest everything | Small documents, infrequent updates |
| Incremental | Track changed chunks, update only those | Large documents, frequent updates |

For large documents (100MB+) stream the file instead of loading it all into memory at once.

---

## New Syntaxes Reference

| Syntax | What it does |
|--------|-------------|
| `pipeline("feature-extraction", model)` | Loads embedding model from Transformers.js |
| `pipe(text, { pooling, normalize })` | Converts text to embedding vector |
| `Array.from(output.data)` | Converts tensor output to plain JS array |
| `new LocalIndex("./vector-db")` | Creates/connects to local vector database |
| `await index.isIndexCreated()` | Checks if vector database exists |
| `await index.createIndex()` | Creates new vector database |
| `await index.insertItem({ vector, metadata })` | Stores embedding with original text |
| `await index.queryItems(embedding, topK)` | Finds most similar chunks |
| `result.score` | Similarity score between 0 and 1 |
| `result.item.metadata.text` | Original text of retrieved chunk |
| `chunks.map(c => c.text).join("\n\n")` | Combines chunk texts into one string |
| `process.argv[2]` | Command line argument passed to script |
| `process.exit(1)` | Exit script with error code |
| `setTimeout(resolve, ms)` | Wait for specified milliseconds |
| `new Promise(resolve => setTimeout(resolve, ms))` | Async wait / sleep |

---

## Performance Considerations

| Operation | Speed | Notes |
|-----------|-------|-------|
| Text extraction | Fast — milliseconds | |
| Chunking | Fast — string operations | |
| Embedding generation | Slow — one call per chunk | Main bottleneck |
| Vector search | Fast — milliseconds | Pre-computed embeddings |
| Model answer generation | Medium — 1-3 seconds | Depends on context size |

---

## ⚠️ Known Limitations

### Local Vector Database
Vectra stores embeddings as local files — fine for learning and small projects. Production RAG systems use dedicated vector databases like Pinecone, Weaviate, or pgvector for scalability and persistence across multiple servers.

### Embedding Model Size
`Xenova/all-MiniLM-L6-v2` is small and fast (~25MB) but less accurate than larger models. For production consider `text-embedding-ada-002` (OpenAI) or `embed-english-v3.0` (Cohere).

### Chunk Quality
Simple word-based chunking can split sentences awkwardly. Production systems use semantic chunking — splitting at natural boundaries like paragraphs and sentences rather than fixed word counts.

### No Re-ingestion Queue
Currently re-ingestion is manual. Production systems queue ingestion jobs so multiple documents can be processed in the background without blocking the API.

---

## Architecture — End of Day 24

```
Client Request
    ↓
Express Server
    ↓
Session Version Check    ← auto-reset if document updated
    ↓
Agent Loop
    ↓
Model decides which tool to call
    ↓
    ├── calculator.js     ← math
    ├── weather.js        ← external API
    ├── notes.js          ← file system
    └── rag.js            ← vector search
            ↓
        vector-db/        ← pre-computed embeddings
            ↓
        relevant chunks injected into prompt
            ↓
        model answers from your data
```

---

# Day 25 — Cloud SaaS Deployment
## Append to Day 24 README

---

## What We Added

- Production preparation (port handling, health check)
- Dockerized the application
- Deployed to Render (free cloud hosting)
- Automated document versioning
- Understood Docker consumer vs producer perspective

---

## Part 1 — Production Preparation

Three changes before any deployment:

### 1. Dynamic Port
```javascript
// Render assigns port dynamically via environment variable
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));
```

### 2. Health Check Endpoint
```javascript
// Render pings this to verify app is alive
app.get("/health", (req, res) => {
    res.status(200).json({ 
        status: "ok",
        timestamp: new Date().toISOString()
    });
});
```

### 3. Build Script in `package.json`
```json
{
    "scripts": {
        "start": "node server.js",
        "build": "node ingest.js"
    }
}
```
Render runs `build` before `start` automatically — ingests your document on every deploy.

---

## Part 2 — Docker

### What is Docker?

Docker packages your app AND everything it needs into one portable unit called a **container** — guaranteed to run identically everywhere.

```
Without Docker:                    With Docker:
──────────────                     ────────────
Works on your laptop     →         Works everywhere identically
"Install Node 20"        →         Node 20 bundled inside
"Set up dependencies"    →         Dependencies bundled inside
"Hope OS matches"        →         Same OS always
```

---

### Three Core Concepts

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│   Dockerfile          Image            Container    │
│   ──────────          ─────            ─────────    │
│   Recipe         →   Blueprint    →   Running App  │
│   (instructions)     (snapshot)       (instance)   │
│                                                     │
│   Like a:        →   Like a:      →   Like a:      │
│   Cookie recipe      Cookie cutter    Cookie        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

- **Dockerfile** — instructions for building the image
- **Image** — frozen snapshot of app + OS + dependencies
- **Container** — running instance of an image

---

### Dockerfile — The Protocol

Always follow this exact order — things that change least go at top, things that change most go at bottom:

```dockerfile
# ① ALWAYS first — base image (your starting point)
FROM node:20-slim
#    ↑      ↑
#  runtime  slim = smaller OS, only essentials

# ② SET working directory — like cd /app inside container
WORKDIR /app

# ③ COPY dependency files FIRST (not source code yet)
COPY package*.json ./
# Why? Docker caches layers. If package.json unchanged,
# npm install layer is reused → saves minutes per build

# ④ INSTALL dependencies inside container
RUN npm install --omit=dev
#                ↑
#           skip devDependencies = smaller image

# ⑤ COPY source code (AFTER install — changes frequently)
COPY . .

# ⑥ EXPOSE port (informational only — doesn't open port)
EXPOSE 3000

# ⑦ ALWAYS last — start command (only one CMD allowed)
CMD ["node", "server.js"]
```

**How to verify correct sequence:**
> "Does this step depend on anything above it? If yes, it comes after."
> "Does this step change frequently? If yes, put it lower."

---

### Layer Caching Visual

```
docker build (first time):          docker build (code changed):
──────────────────────────          ────────────────────────────
FROM node:20-slim      ✓ run        FROM node:20-slim      ⚡ cached
WORKDIR /app           ✓ run        WORKDIR /app           ⚡ cached
COPY package*.json     ✓ run        COPY package*.json     ⚡ cached
RUN npm install        ✓ run        RUN npm install        ⚡ cached ← saves time
COPY . .               ✓ run        COPY . .               ✓ run
CMD ["node"...]        ✓ run        CMD ["node"...]        ✓ run
```

Copying `package.json` before source code means `npm install` is only re-run when dependencies actually change.

---

### `.dockerignore`

Same concept as `.gitignore` — tells Docker what NOT to copy into image:

```
node_modules    ← reinstalled inside container
.env            ← secrets passed separately at runtime
vector-db       ← regenerated by ingest.js
sessions.json   ← runtime data
logs            ← runtime data
.git            ← git history not needed
```

---

### Essential Docker Commands

```bash
# Build image from Dockerfile
docker build -t my-app .

# Run container from image
docker run -p 3000:3000 --env-file .env my-app
#           ↑                ↑
#    map container:local    load all .env variables

# List local images
docker images

# List running containers
docker ps

# List all containers (including stopped)
docker ps -a

# Stop a container
docker stop <container-id>

# View container logs
docker logs <container-id>

# Open shell inside running container (debugging)
docker exec -it <container-id> sh

# Remove an image
docker rmi my-app

# Push to Docker Hub
docker tag my-app username/my-app
docker push username/my-app
```

---

### Full Docker Flow

```
Your Code + Dockerfile
        ↓
   docker build          ← creates image locally
        ↓
  Local Image Store
        ↓
   docker run            ← runs container locally (testing)
        ↓
   docker push           ← uploads to Docker Hub / Registry
        ↓
  Cloud Registry
        ↓
  Render pulls image     ← deploys your container
        ↓
  Live on internet
```

---

## Part 3 — Render Deployment

### Configuration

```
Name:          your-app-name
Environment:   Node
Build Command: npm install && npm run build
Start Command: npm start
```

### Environment Variables
Set in Render dashboard → Environment tab:
```
GROQ_API_KEY=your_key
OPENWEATHER_API_KEY=your_key
DOCUMENT_VERSION=1
```

### Automatic Deploy Flow
```
You push to GitHub
        ↓
Render detects new commit
        ↓
Runs: npm install && npm run build (ingest.js)
        ↓
Runs: npm start (server.js)
        ↓
Live with updated knowledge base
```

---

## Part 4 — Automated Document Versioning

Instead of manually bumping a number, generate version from file's last modified time:

```javascript
// config.js
import fs from "fs";

const stats = fs.statSync("./document.txt");
// mtimeMs = last modified timestamp in milliseconds
// changes automatically whenever document.txt is saved
export const DOCUMENT_VERSION = stats.mtimeMs;
```

**New workflow — no manual version bumping:**
```
Update document.txt
        ↓
git push
        ↓
Render auto-deploys + re-ingests
        ↓
All sessions auto-reset (version changed)
        ↓
Users get fresh data automatically
```

---

## Q&A — Key Concepts

### Who Uses Docker and How?

```
Three scenarios when using someone else's tool:

Scenario 1 — Docker Hub image (easiest)
────────────────────────────────────────
docker run -p 3000:3000 -e API_KEY=key theirname/theirtool
↑ One command. Docker downloads and runs. No code needed.

Scenario 2 — GitHub repo with Dockerfile
─────────────────────────────────────────
git clone https://github.com/them/theirtool
cp .env.example .env    ← fill in your keys
docker build -t theirtool .
docker run -p 3000:3000 --env-file .env theirtool

Scenario 3 — docker-compose (multiple services)
────────────────────────────────────────────────
git clone https://github.com/them/theirtool
cp .env.example .env
docker-compose up       ← starts everything in one command
```

### npm World vs Docker World

| npm world | Docker world |
|-----------|-------------|
| `npm install` | `docker pull` |
| `package.json` | `Dockerfile` |
| `.npmignore` | `.dockerignore` |
| npm registry | Docker Hub |
| `npm start` | `docker run` |
| `node_modules/` | Image layers |

---

### How Frontend Integrates with Your Backend

```
Frontend (React/HTML)              Backend (Express)
─────────────────────              ─────────────────
Lives in browser              ←→   Lives on server
Shows UI to user                   Handles business logic
Makes HTTP requests                Responds to HTTP requests
Knows nothing about DB             Knows nothing about UI

Communication: HTTP requests (same as curl, just from browser)
Your backend API needs zero changes to support a frontend
```

**In Docker — deployed as separate containers:**
```
┌─────────────────┐     HTTP      ┌─────────────────┐
│    Frontend     │ ────────────► │    Backend      │
│   Container     │               │   Container     │
│  (React app)    │ ◄──────────── │  (Express API)  │
└─────────────────┘               └─────────────────┘
```

---

### Two Types of Users

```
End User                           Developer/Enterprise User
────────────                       ─────────────────────────
Visits your URL                    Clones your GitHub repo
Uses frontend UI                   Runs Docker container
Never sees code                    Self-hosts your tool
No setup needed                    One-time Docker setup
```

---

## New Syntaxes Reference

| Syntax | What it does |
|--------|-------------|
| `process.env.PORT \|\| 3000` | Uses cloud-assigned port or falls back to 3000 |
| `fs.statSync("file")` | Gets file metadata synchronously |
| `stats.mtimeMs` | Last modified timestamp in milliseconds |
| `FROM node:20-slim` | Base Docker image |
| `WORKDIR /app` | Sets working directory inside container |
| `COPY package*.json ./` | Copies package files for layer caching |
| `RUN npm install --omit=dev` | Installs production dependencies only |
| `COPY . .` | Copies all source files |
| `EXPOSE 3000` | Documents which port app uses |
| `CMD ["node", "server.js"]` | Command to start container |
| `docker build -t name .` | Builds image from Dockerfile |
| `docker run -p 3000:3000` | Runs container, maps ports |
| `docker images` | Lists all local images |
| `docker ps` | Lists running containers |
| `docker logs <id>` | Views container output |
| `docker exec -it <id> sh` | Opens shell inside container |

---

## ⚠️ Known Limitations

### Render Free Tier
- App spins down after 15 minutes of inactivity
- Takes ~30 seconds to wake up on first request after sleep
- Fine for learning and demos — upgrade for production

### Stateless Containers
Containers are stateless by default — `sessions.json` is lost on restart. For production use a managed database (PostgreSQL, Redis) instead of file-based storage.

### Single Container Limitation
Current setup runs everything in one container. Production apps split into multiple containers — one for API, one for database, one for frontend — orchestrated with Docker Compose or Kubernetes.