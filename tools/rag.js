import { LocalIndex } from "vectra";
import { pipeline } from "@xenova/transformers";

let pipe = null;

async function getEmbedding(text) {
    if (!pipe) {
        pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    }
    const output = await pipe(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
}

export async function searchDocument({ question }) {
    try {
        const index = new LocalIndex("./vector-db");

        // Check if index exists — ingest.js must be run first
        if (!await index.isIndexCreated()) {
            return "Document database not found. Please run ingestion first.";
        }

        const questionEmbedding = await getEmbedding(question);
        const results = await index.queryItems(questionEmbedding, 2);

        // Filter by minimum relevance score
        const relevantChunks = results
            .filter(result => result.score > 0.3)
            .map(result => result.item.metadata.text);

        if (relevantChunks.length === 0) {
            return "No relevant information found in the document for this question.";
        }

        // Return chunks as context — agent will use this to answer
        return relevantChunks.join("\n\n");

    } catch (error) {
        return `Error searching document: ${error.message}`;
    }
}