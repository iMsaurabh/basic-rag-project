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

---

# Day 26 — Self-Hosted Deployment

## What We Added

- Docker Compose for multi-container setup
- Redis for persistent session storage
- Configuration system via environment variables
- Admin endpoints for system management
- Self-hosting documentation

---

## What is Self-Hosted?

```
Cloud SaaS (Day 25)          Self-Hosted (Day 26)
────────────────────         ────────────────────
You run the server      →    They run the server
You manage everything   →    They manage everything
Your API keys           →    Their own API keys
Your document           →    Their own documents
Users just use URL      →    Developer runs Docker
```

Who wants self-hosted:
- Enterprise — data never leaves their servers
- Healthcare/Finance — regulatory compliance
- Privacy conscious — don't trust third party cloud
- Developers — want full control

---

## Part 1 — Docker Compose

### What is Docker Compose?

```
docker run        → one container, one command
docker compose up → multiple containers, one command
                    all configured in docker-compose.yml
```

### Container Architecture

```
Your Machine
    └── Docker
            ├── api container      ← your Express server
            │     Port: 3000
            │     Built from: Dockerfile
            │
            └── redis container    ← session storage
                  Port: 6379
                  Built from: redis:7-alpine (Docker Hub)
```

### `docker-compose.yml` Explained

```yaml
services:

  api:
    build: .                    # build from Dockerfile in current dir
    ports:
      - "3000:3000"             # host:container port mapping
    env_file:
      - .env                    # load all variables from .env
    volumes:
      - ./document.txt:/app/document.txt  # mount file from host
      - ./vector-db:/app/vector-db        # persist vector db
      - ./logs:/app/logs                  # persist logs
    depends_on:
      - redis                   # wait for redis before starting
    restart: unless-stopped     # auto-restart on crash

  redis:
    image: redis:7-alpine       # official image, no Dockerfile needed
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data        # named volume — managed by Docker
    restart: unless-stopped

volumes:
  redis-data:                   # Docker manages this volume's lifecycle
```

### Container Networking

```
Inside Docker Compose network:
  localhost = only that container itself
  api       = the api container
  redis     = the redis container

// Wrong — api container can't reach redis via localhost
const redis = new Redis("redis://localhost:6379");

// Correct — use service name as hostname
const redis = new Redis("redis://redis:6379");
```

---

## Part 2 — Redis Session Storage

### Why Redis Replaces sessions.json

```
sessions.json (before)         Redis (after)
──────────────────────         ─────────────
File on disk                   In-memory database
Lost on container restart      Persists via Docker volume
Slow for large data            Extremely fast
Single container only          Works across containers
No expiry                      TTL — sessions auto-expire
```

### Redis Key Operations

```javascript
// Store with expiry (TTL)
await redis.setex(
    `session:${sessionId}`,  // key — prefixed for organization
    86400,                    // TTL in seconds (24 hours)
    JSON.stringify(session)   // value must be string
);

// Retrieve
const data = await redis.get(`session:${sessionId}`);
const session = JSON.parse(data);

// Delete
await redis.del(`session:${sessionId}`);

// Find all session keys
const keys = await redis.keys("session:*");  // * = wildcard
```

### Session Persistence Test

```bash
# Send message
curl -X POST http://localhost:3000/chat \
  -d '{"sessionId": "user1", "message": "What is the refund policy?"}'

# Restart api container (NOT redis)
docker compose restart api

# Ask follow up — session still exists in Redis
curl -X POST http://localhost:3000/chat \
  -d '{"sessionId": "user1", "message": "What did I just ask?"}'

# Expected: "You asked about the refund policy"
```

---

## Part 3 — Configuration System

Every setting configurable via environment variable with sensible defaults:

```javascript
// config.js
export const PORT = process.env.PORT || 3000;
export const MAX_ITERATIONS = parseInt(process.env.MAX_ITERATIONS) || 10;
export const MAX_HISTORY = parseInt(process.env.MAX_HISTORY) || 10;
export const MAX_MESSAGE_LENGTH = parseInt(process.env.MAX_MESSAGE_LENGTH) || 1000;
export const MAX_SESSION_ID_LENGTH = parseInt(process.env.MAX_SESSION_ID_LENGTH) || 50;
export const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
export const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 10;
export const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
export const SESSION_TTL = parseInt(process.env.SESSION_TTL) || 86400;
```

Self-hosters customize by editing `.env` — never touching code.

---

## Part 4 — Admin Endpoints

```javascript
// GET /admin/status — system overview
{
    status: "ok",
    timestamp: "2026-03-16T...",
    documentVersion: 1234567890,
    activeSessions: 3,
    uptime: 3600,           // seconds since start
    memory: {
        used: 45,           // MB currently used
        total: 128,         // MB total allocated
        unit: "MB"
    }
}

// POST /admin/clear-all-sessions — wipe all sessions
{
    message: "All sessions cleared",
    cleared: 3
}
```

**`process.memoryUsage()` explained:**
```javascript
process.memoryUsage().heapUsed   // memory your app is actively using
process.memoryUsage().heapTotal  // memory Node.js has allocated
// divide by 1024 twice to convert bytes → KB → MB
Math.round(heapUsed / 1024 / 1024)
```

---

## Q&A — Key Concepts

### Container vs Server

```
Physical Server (the building)
    └── Operating System (the floors)
            ├── Container 1 — api        (room 1)
            ├── Container 2 — redis      (room 2)
            └── Container 3 — nginx      (room 3)

Each container:
  ✓ Has its own isolation (walls)
  ✓ Has its own dependencies (furniture)
  ✓ Shares the OS kernel (building electricity)
  ✓ Can talk to other containers via service names
```

### How Many Containers?

One container per distinct service/responsibility:

```
Ask: "Is this a separate concern that could fail independently?"

api     → handles HTTP requests          → one container
redis   → handles data storage           → one container
nginx   → handles routing/HTTPS          → one container
worker  → handles background jobs        → one container
```

### Your Code vs Container vs Image

```
LAYER 1 — YOUR CODE (files you write)
  server.js, agent.js, tools/, Dockerfile...

LAYER 2 — IMAGE (docker build creates this)
  Frozen snapshot: Linux OS + Node.js + your code + dependencies

LAYER 3 — CONTAINER (docker compose up creates this)
  Running instance of the image
  Has memory, network, isolated filesystem

Your code → docker build → Image → docker run → Container
```

### Running With vs Without Docker

| | Without Docker | With Docker |
|---|---|---|
| Command | `node server.js` | `docker compose up` |
| Redis | Need local Redis or use sessions.json | Included automatically |
| Use when | Local development | Testing prod setup, sharing |
| Code changes | Instant | Needs `--build` |

---

## Docker Compose Command Reference

```bash
# Start all containers in background
docker compose up -d

# Start and rebuild images
docker compose up --build -d

# Stop all containers
docker compose down

# Stop and wipe volumes (fresh start)
docker compose down -v

# Restart one service
docker compose restart api

# View all container status
docker compose ps

# View logs
docker compose logs

# Follow logs in real time
docker compose logs -f

# Follow logs for one service
docker compose logs -f api

# Open shell inside container
docker compose exec api sh
```

---

## New Syntaxes Reference

| Syntax | What it does |
|--------|-------------|
| `docker compose up -d` | Start containers in background (detached) |
| `docker compose up --build` | Rebuild images before starting |
| `docker compose down -v` | Stop containers and remove volumes |
| `redis.setex(key, ttl, value)` | Store in Redis with expiry time |
| `redis.get(key)` | Retrieve from Redis |
| `redis.del(key)` | Delete from Redis |
| `redis.keys("pattern:*")` | Find all keys matching pattern |
| `process.uptime()` | Seconds since Node.js process started |
| `process.memoryUsage()` | Memory stats in bytes |
| `parseInt(value) \|\| default` | Parse env var as integer with fallback |
| `depends_on` | Docker Compose — wait for service before starting |
| `restart: unless-stopped` | Auto-restart container on crash |

---

## ⚠️ Known Limitations

### No Authentication on Admin Endpoints
`/admin/status` and `/admin/clear-all-sessions` are publicly accessible. In production add an admin API key check:
```javascript
app.use("/admin", (req, res, next) => {
    if (req.headers["x-admin-key"] !== process.env.ADMIN_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
});
```

### Redis Data Loss on `docker compose down -v`
`-v` flag removes volumes including Redis data. Always use `docker compose down` without `-v` to preserve sessions.

### Single Machine Only
Current setup runs all containers on one machine. For high availability across multiple machines you need Kubernetes or Docker Swarm — beyond scope of this learning path.

### WSL2 Required on Windows
Docker Desktop on Windows requires WSL2 with a Linux distribution installed. Run `wsl --install` in PowerShell as Administrator if not already set up.

# Day 27 - Browser Extension

Check [my AI-Chat-Assistant-Project](https://github.com/iMsaurabh/AI-Chat-Browser-Extension)

# Day 28 - Front End UI

Check [my AI-Chat-Assistant-FrontEnd-UI Project](https://github.com/iMsaurabh/AI-Assistant-FrontEnd.git)

---

# Day 29 — Authentication & Multi-tenancy

## What We Added

- User registration and login
- JWT token authentication
- Protected API routes
- Multi-tenancy — users only see their own data
- Persistent chat history tied to user account
- Frontend auth flow with login/register UI

---

## Architecture After Day 29

```
Client Request
    ↓
CORS middleware           ← allows frontend origin
    ↓
express.json()            ← parses body
    ↓
Public routes (/auth/*)   ← no token needed
    ↓
requireAuth middleware    ← verifies JWT token
    ↓
Protected routes          ← req.user available here
    ↓
Multi-tenant data         ← userId:sessionId isolation
```

---

## Core Concepts

### 1. Password Hashing with bcrypt

Never store plain text passwords. bcrypt hashes them one-way:

```javascript
import bcrypt from "bcryptjs";

// Hash on registration — 10 = salt rounds (higher = more secure, slower)
const hashedPassword = await bcrypt.hash(password, 10);

// Compare on login — bcrypt handles the salt automatically
const valid = await bcrypt.compare(plainPassword, hashedPassword);
// true = passwords match, false = wrong password
```

**Why salt rounds matter:**
```
Salt rounds 10 = ~100ms per hash    ← good balance
Salt rounds 12 = ~400ms per hash    ← more secure
Salt rounds 14 = ~1.5s per hash     ← too slow for login
```

---

### 2. JWT — JSON Web Token

Three parts separated by dots:
```
eyJhbGc.eyJ1c2VySWQiOjEsImVtYWlsIjoidGVzdEB0ZXN0LmNvbSJ9.signature
   ↑              ↑                                              ↑
 header        payload (base64 encoded)                    signature
```

```javascript
import jwt from "jsonwebtoken";

// Create token — includes user data, expires in 24h
const token = jwt.sign(
    { id: user.id, email: user.email, plan: user.plan },
    process.env.JWT_SECRET,
    { expiresIn: "24h" }
);

// Verify token — throws if invalid or expired
const decoded = jwt.verify(token, process.env.JWT_SECRET);
// decoded = { id: 1, email: "test@test.com", plan: "free", iat: ..., exp: ... }
```

**Token lifecycle:**
```
Register/Login
    ↓
Server creates token with user data
    ↓
Client stores in localStorage
    ↓
Every request sends: Authorization: Bearer <token>
    ↓
Server verifies on every protected route
    ↓
Token expires after 24h → user must login again
```

---

### 3. Auth Middleware

Runs before protected route handlers, extracts and verifies token:

```javascript
export function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    // Check header exists and has correct format
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
    }

    // "Bearer eyJhbG..." → split → ["Bearer", "eyJhbG..."] → [1]
    const token = authHeader.split(" ")[1];

    try {
        const decoded = verifyToken(token);
        req.user = decoded;  // attach to request — available in route handlers
        next();              // token valid — proceed
    } catch (error) {
        return res.status(401).json({ error: "Invalid or expired token" });
    }
}

// Applied to routes that need protection
app.post("/chat", requireAuth, ...handlers);
//                ↑
//    runs before route handler
//    req.user available after this
```

---

### 4. Express Router

Organizes routes into separate files:

```javascript
// routes/auth.js
import express from "express";
const router = express.Router();  // mini Express app

router.post("/register", handler);
router.post("/login", handler);

export default router;

// server.js
import authRoutes from "./routes/auth.js";
app.use("/auth", authRoutes);
// → POST /auth/register
// → POST /auth/login
```

---

### 5. SQLite with better-sqlite3

Zero-setup file-based database — no server needed:

```javascript
import Database from "better-sqlite3";

const db = new Database("./data/app.db");

// Pragma — database configuration
db.pragma("journal_mode = WAL");  // better concurrent performance

// Create table
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        email      TEXT UNIQUE NOT NULL,
        password   TEXT NOT NULL,
        plan       TEXT DEFAULT 'free',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Query methods:
db.prepare("SELECT * FROM users WHERE email = ?").get(email);
//                                                  ↑
//                                          ? = parameterized query
//                                          prevents SQL injection
//                                          .get() = one row or undefined

db.prepare("INSERT INTO users (email, password) VALUES (?, ?)").run(email, hash);
// .run() = INSERT/UPDATE/DELETE — returns { lastInsertRowid, changes }

db.prepare("SELECT * FROM users").all();
// .all() = multiple rows as array
```

---

### 6. Multi-tenancy — Data Isolation

Every user's data is isolated by prefixing with userId:

```javascript
// Without multi-tenancy — any user can access any session
const sessionKey = sessionId;  // "my-chat"

// With multi-tenancy — each user has their own namespace
const sessionKey = `${req.user.id}:${sessionId}`;  // "1:my-chat"

// User 1: "1:my-chat"   ← completely separate
// User 2: "2:my-chat"   ← from each other
```

**Filtering sessions per user:**
```javascript
const allKeys = await listSessions();

// Only return keys belonging to this user
const userSessions = allKeys
    .filter(key => key.startsWith(`${req.user.id}:`))
    .map(key => ({
        sessionId: key.split(":")[1]  // remove userId prefix
    }));
```

---

### 7. JWT Decoding on Frontend

Extract user info from token without making an API call:

```javascript
// JWT payload is base64 encoded in second segment
// header.PAYLOAD.signature

function getSessionId() {
    const token = getToken();
    if (!token) return null;

    // atob() = browser API to decode base64 string
    const payload = JSON.parse(atob(token.split(".")[1]));
    return `session-${payload.id}`;
}
// Same user always gets same sessionId → history persists across login/logout
```

---

### 8. Chat History Persistence Flow

```
User logs in
    ↓
Frontend decodes JWT → gets userId → derives sessionId
    ↓
Frontend calls GET /chat/history
    ↓
Backend loads session from Redis using userId:sessionId
    ↓
Returns messages filtered to user/assistant only (no system)
    ↓
Frontend formats and displays history
    ↓
User continues conversation seamlessly
```

---

## Auth Flow Diagrams

### Registration
```
Frontend                    Backend                     Database
────────                    ───────                     ────────
POST /auth/register    →    Validate email/password
                            Check email not taken   →   SELECT users WHERE email=?
                            Hash password
                            Insert user             →   INSERT INTO users
                            Generate JWT token
                       ←    Return { token }
Store token in
localStorage
Redirect to chat
```

### Login
```
Frontend                    Backend                     Database
────────                    ───────                     ────────
POST /auth/login       →    Validate input
                            Find user by email      →   SELECT * WHERE email=?
                            bcrypt.compare()
                            Generate JWT token
                       ←    Return { token }
Store token in
localStorage
Redirect to chat
```

### Protected Request
```
Frontend                    Backend
────────                    ───────
GET /chat/history      →    requireAuth middleware
Authorization:              Extract token from header
Bearer eyJhbG...            jwt.verify(token, secret)
                            Attach req.user = decoded
                            Route handler runs
                            Load session from Redis
                       ←    Return { messages }
Display history
```

---

## API Endpoints After Day 29

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/register` | ❌ Public | Register new user |
| `POST` | `/auth/login` | ❌ Public | Login, get token |
| `POST` | `/chat` | ✅ Required | Send message |
| `GET` | `/chat/history` | ✅ Required | Load chat history |
| `GET` | `/sessions` | ✅ Required | List user sessions |
| `DELETE` | `/chat/:sessionId` | ✅ Required | Clear session |
| `GET` | `/health` | ❌ Public | Health check |
| `GET` | `/admin/status` | ❌ Public | System status |

---

## New Syntaxes Reference

| Syntax | What it does |
|--------|-------------|
| `bcrypt.hash(password, 10)` | Hash password with 10 salt rounds |
| `bcrypt.compare(plain, hash)` | Compare plain password to hash |
| `jwt.sign(payload, secret, opts)` | Create signed JWT token |
| `jwt.verify(token, secret)` | Verify and decode JWT token |
| `{ expiresIn: "24h" }` | Token expiry option |
| `req.headers.authorization` | Authorization header from request |
| `header.split(" ")[1]` | Extract token from "Bearer TOKEN" |
| `req.user = decoded` | Attach user data to request object |
| `express.Router()` | Create modular route handler |
| `app.use("/path", router)` | Mount router at path prefix |
| `db.prepare(sql).get(params)` | SQLite query returning one row |
| `db.prepare(sql).run(params)` | SQLite INSERT/UPDATE/DELETE |
| `db.prepare(sql).all(params)` | SQLite query returning all rows |
| `db.exec(sql)` | Run SQL without parameters |
| `db.pragma("journal_mode = WAL")` | Set database configuration |
| `atob(base64string)` | Decode base64 string in browser |
| `key.startsWith("prefix:")` | Filter keys by prefix |
| `key.split(":")[1]` | Extract part after colon |
| `!!value` | Convert value to boolean |
| `.normalizeEmail()` | Lowercase email, remove dots |

---

## Environment Variables Added

```bash
# .env
JWT_SECRET=your-very-long-random-secret-key-here
JWT_EXPIRES=24h
```

**Generating a secure JWT secret:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## ⚠️ Known Limitations

### JWT Secret in Code
Default JWT secret falls back to hardcoded string if env var not set. Always set `JWT_SECRET` in production — never use the default.

### No Token Refresh
Tokens expire after 24h and users must login again. Production apps implement refresh tokens for seamless re-authentication.

### No Password Reset
No forgot password flow. Would require email sending (nodemailer) and reset tokens stored in database.

### SQLite Single File
SQLite works for single server. For multiple servers use PostgreSQL or MySQL — same SQL syntax, different driver.

### Admin Endpoints Unprotected
`/admin/status` and `/admin/clear-all-sessions` have no auth. Add admin middleware before going to production:
```javascript
function requireAdmin(req, res, next) {
    if (req.headers["x-admin-key"] !== process.env.ADMIN_KEY) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
}
app.use("/admin", requireAdmin);
```