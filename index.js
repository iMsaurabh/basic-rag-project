// index.js
import { runAgent } from "./agent.js";

// Caller maintains the conversation history
const messages = [
    { role: "system", content: "You are a helpful assistant." }
];

// Turn 1
messages.push({ role: "user", content: "What is the weather in Agra?" });
const reply1 = await runAgent(messages);
messages.push({ role: "assistant", content: reply1 });
console.log("Assistant:", reply1);

// Turn 2 — model now knows about previous weather response
messages.push({ role: "user", content: "Save that as a note." });
const reply2 = await runAgent(messages);
messages.push({ role: "assistant", content: reply2 });
console.log("Assistant:", reply2);