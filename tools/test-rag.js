import { searchDocument } from "./tools/rag.js";

const result = await searchDocument({ question: "What is the refund policy?" });
console.log("RAG result:", result);