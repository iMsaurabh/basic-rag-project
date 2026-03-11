import "dotenv/config";
import Groq from "groq-sdk";
import { calculator } from "./tools/calculator.js";
import { getWeather } from "./tools/weather.js";
import { saveNote, readNotes, deleteNotes } from "./tools/notes.js";
import { searchDocument } from "./tools/rag.js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const model = "llama3-groq-70b-8192-tool-use-preview";
const MAX_ITERATIONS = 10;
const MAX_HISTORY = 10;

const MODELS = [
    "llama3-groq-70b-8192-tool-use-preview",
    "llama-3.3-70b-versatile",
    "canopylabs/orpheus-v1-english",
    "moonshotai/kimi-k2-instruct-0905"
];

async function callWithFallback(params) {
    for (const model of MODELS) {
        try {
            const response = await groq.chat.completions.create({
                ...params,  // spread all params — model, tools, messages etc
                model       // override model with current fallback attempt
            });

            // Validate response — reject if model returned raw tool call syntax
            const content = response.choices[0].message.content;
            if (content && content.includes("<function=")) {
                console.log(`Model ${model} returned invalid response, trying next...`);
                continue; // skip to next model
            }

            return response;

        } catch (error) {
            console.log(`Model ${model} failed: ${error.message}, trying next...`);
        }
    }
    throw new Error("All models failed");
}

async function callWithRetry(params, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await callWithFallback(params);
            return response;
        } catch (error) {
            console.log(`Attempt ${attempt} failed: ${error.message}`);

            if (attempt === maxRetries) throw error;

            // wait before retrying
            // 1000 * attempt = 1s, 2s, 3s — increases with each attempt
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}

const tools = [
    {
        type: "function",
        function: {
            name: "calculator",
            description: "Use this ONLY when the user explicitly asks to calculate or solve a math expression. Do not use for any other purpose.",
            parameters: {
                type: "object",
                properties: {
                    expression: {
                        type: "string",
                        description: "The math expression to evaluate e.g. 10 * 5"
                    }
                },
                required: ["expression"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "weather",
            description: "Use this ONLY when the user explicitly asks for weather information for a city.",
            parameters: {
                type: "object",
                properties: {
                    city: {
                        type: "string",
                        description: "The city name to get weather for"
                    }
                },
                required: ["city"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "saveNote",
            description: "Use this ONLY when the user explicitly asks to save or remember a note.",
            parameters: {
                type: "object",
                properties: {
                    note: {
                        type: "string",
                        description: "The note text to save"
                    }
                },
                required: ["note"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "readNotes",
            description: "Use this ONLY when the user explicitly asks to read or see saved notes.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "deleteNotes",
            description: "Use this ONLY when the user explicitly asks to delete all notes.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function",
        function: {
            name: "searchDocument",
            description: "Use this ONLY when the user asks about company policies, pricing, features, privacy, or technical requirements.",
            parameters: {
                type: "object",
                properties: {
                    question: {
                        type: "string",
                        description: "The question to search for in the document"
                    }
                },
                required: ["question"]
            }
        }
    }
];

const toolFunctions = {
    calculator,
    weather: getWeather,
    saveNote,
    readNotes,
    deleteNotes,
    searchDocument
};

export async function runAgent(messages) {
    try {
        const MAX_HISTORY = 10;
        const trimmedMessages = [
            messages[0],
            ...messages.slice(1).slice(-MAX_HISTORY)
        ];

        let response = await callWithRetry({
            tools,
            messages: trimmedMessages,
            tool_choice: "auto"
        });

        let message = response.choices[0].message;
        let iterations = 0;

        while (message.tool_calls && message.tool_calls.length > 0) {
            iterations++;
            if (iterations > MAX_ITERATIONS) {
                console.log("Max iterations reached, stopping.");
                break;
            }

            messages.push(message);

            for (const toolCall of message.tool_calls) {
                const toolName = toolCall.function.name;
                const toolArgs = JSON.parse(toolCall.function.arguments);

                console.log(`Tool call: ${toolName}`);

                const toolFunction = toolFunctions[toolName];

                if (!toolFunction) {
                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: `Tool "${toolName}" is not available.`
                    });
                    continue;
                }

                const toolResult = await toolFunction(toolArgs);

                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: String(toolResult)
                });
            }

            const trimmed = [
                messages[0],
                ...messages.slice(1).slice(-MAX_HISTORY)
            ];

            response = await callWithRetry({
                tools,
                messages: trimmed,
                tool_choice: "auto"
            });

            message = response.choices[0].message;
        }

        return message.content;

    } catch (error) {
        console.error("Agent error:", error.message);
        return "I encountered an error processing your request. Please try again.";
    }
}