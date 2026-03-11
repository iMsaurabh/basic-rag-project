import "dotenv/config";
import Groq from "groq-sdk";
import { LocalIndex } from "vectra";
import { pipeline } from "@xenova/transformers";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Reuse same embedding model and settings as ingest.js
// CRITICAL: must use identical model and settings as ingestion
// different model = different number space = wrong results
let pipe = null;

async function getEmbedding(text) {
    if (!pipe) {
        pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    }
    const output = await pipe(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
}

async function query(question) {
    // Load the vector database
    const index = new LocalIndex("./vector-db");

    // Embed the question using same model as ingestion
    console.log("Embedding question...");
    const questionEmbedding = await getEmbedding(question);

    // Search for most similar chunks
    // topK: 2 = return 2 most relevant chunks
    const results = await index.queryItems(questionEmbedding, 2);

    if (results.length === 0) {
        return "No relevant information found in the document.";
    }

    // Extract text from results
    // results is array of { item: { metadata: { text } }, score }
    // score is similarity score between 0 and 1 — higher is more similar
    // Only use chunks above 0.3 similarity
    const relevantChunks = results
        .filter(result => result.score > 0.3)
        .map(result => ({
            text: result.item.metadata.text,
            score: result.score.toFixed(3)
        }));

    if (relevantChunks.length === 0) {
        return "I could not find relevant information to answer your question.";
    }

    console.log("Relevant chunks found:");
    relevantChunks.forEach(chunk => {
        console.log(`Score: ${chunk.score} — ${chunk.text.substring(0, 80)}...`);
    });

    // Build context from retrieved chunks
    const context = relevantChunks.map(c => c.text).join("\n\n");

    // Send context + question to Groq
    // This is called "context injection" — we inject relevant data into the prompt
    const response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
            {
                role: "system",
                content: "Answer questions based only on the provided context. If the answer is not in the context, say so clearly."
            },
            {
                role: "user",
                content: `Context:\n${context}\n\nQuestion: ${question}`
            }
        ]
    });

    return response.choices[0].message.content;
}

// Get question from command line argument
// process.argv = ["node", "query.js", "your question here"]
// process.argv[2] = the question you pass in
const question = process.argv[2];

if (!question) {
    console.log("Usage: node query.js \"your question here\"");
    process.exit(1);  // exit with error code 1 — means something went wrong
}

console.log(`Question: ${question}\n`);
const answer = await query(question);
console.log(`\nAnswer: ${answer}`);