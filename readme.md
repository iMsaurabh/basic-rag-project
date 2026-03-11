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