import fs from "fs";
import path from "path";
import { LocalIndex } from "vectra";
import { pipeline } from "@xenova/transformers";


// STEP1: Load and chunk documents
// Function to split text into overlapping chunks
// overlap ensures context isn't lost at chunk boundaries
function chunkText(text, chunkSize = 50, overlap = 10) {
    const words = text.split(" ");      // split into individual words
    const chunks = [];
    let i = 0;

    while (i < words.length) {
        // take chunkSize words starting at position i
        const chunk = words.slice(i, i + chunkSize).join(" ");
        chunks.push(chunk);
        // move forward by chunkSize minus overlap
        // overlap means next chunk shares some words with previous
        // this prevents losing context at boundaries
        i += chunkSize - overlap;
    }

    return chunks;
}

// STEP2: Generate Embeddings
// pipe is our embedding model — loaded once and reused
// "feature-extraction" = convert text to numbers
// "Xenova/all-MiniLM-L6-v2" = small, fast, free embedding model
let pipe = null;

async function getEmbedding(text) {
    if (!pipe) {
        console.log("Loading embedding model...");
        // model downloads automatically on first run (~25MB)
        // subsequent runs use cached version
        pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    }

    const output = await pipe(text, {
        pooling: "mean",      // average all token embeddings into one vector
        normalize: true       // normalize to unit length — required for similarity search
    });

    // Array.from converts the tensor output to a plain JS array
    return Array.from(output.data);
}

// STEP3: Store in Vector Database

async function ingest() {
    console.log("Starting ingestion...");

    // LocalIndex creates a folder to store embeddings
    // Think of it as your local vector database
    const index = new LocalIndex("./vector-db");

    // Create index if it doesn't exist yet
    if (!await index.isIndexCreated()) {
        await index.createIndex();
        console.log("Vector database created.");
    }

    // Read source document
    const text = fs.readFileSync("./document.txt", "utf8");
    console.log(`Document loaded: ${text.length} characters`);

    // Split into chunks
    const chunks = chunkText(text);
    console.log(`Split into ${chunks.length} chunks`);

    // Embed and store each chunk
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = await getEmbedding(chunk);

        // addItem stores the embedding with its original text
        // metadata is the data you get back when searching
        await index.insertItem({
            vector: embedding,       // the numbers representing meaning
            metadata: { text: chunk, index: i }  // original text kept alongside
        });

        console.log(`Stored chunk ${i + 1}/${chunks.length}`);
    }

    console.log("Ingestion complete. Vector database ready.");
}

// Run ingestion
ingest();