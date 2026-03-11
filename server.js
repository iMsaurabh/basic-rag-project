import "dotenv/config";
import express from "express";
import { runAgent } from "./agent.js";
// body is a function that validates fields in req.body
// validationResult collects all validation errors
import { body, validationResult } from "express-validator";
import rateLimit from "express-rate-limit";

import morgan from "morgan";
import logger from "./logger.js";

import { DOCUMENT_VERSION, MAX_HISTORY } from "./config.js";

import { loadSessions, saveSessions } from "./sessionStore.js";

const app = express();

// Middleware — parses incoming JSON request bodies
// Without this, req.body would be undefined
app.use(express.json());

// morgan logs every HTTP request automatically
// "combined" is a standard Apache log format
// stream tells morgan to use winston instead of console.log
app.use(morgan("combined", {
    stream: {
        write: (message) => logger.info(message.trim())
    }
}));

// Global limiter — applies to ALL routes
// Prevents general abuse of your API
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes in milliseconds
    max: 100,                   // max 100 requests per windowMs per IP
    message: { error: "Too many requests, please try again after 15 minutes" },
    standardHeaders: true,      // adds rate limit info to response headers
    legacyHeaders: false        // disables old X-RateLimit headers
});

// Strict limiter — applies to /chat only
// AI calls are expensive, limit them more aggressively
const chatLimiter = rateLimit({
    windowMs: 60 * 1000,       // 1 minute
    max: 10,                   // max 10 chat requests per minute per IP
    message: { error: "Too many chat requests, please wait a minute" },
    standardHeaders: true,
    legacyHeaders: false
});

// Global limiter — apply before all routes
app.use(globalLimiter);

// Array of validation rules for /chat endpoint
const validateChat = [
    body("sessionId")
        .isString()                          // must be a string
        .trim()                              // remove whitespace from both ends
        .notEmpty()                          // cannot be empty after trim
        .withMessage("sessionId is required")// custom error message
        .isLength({ max: 50 })               // max 50 characters
        .withMessage("sessionId too long"),  // custom error message for length

    body("message")
        .isString()
        .trim()
        .notEmpty()
        .withMessage("message is required")
        .isLength({ min: 1, max: 1000 })     // between 1 and 1000 characters
        .withMessage("message must be between 1 and 1000 characters"),
];

// Reusable middleware that checks if validation passed
// If not, sends 400 with list of errors
function checkValidation(req, res, next) {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        // Log validation errors with request context
        logger.error("Validation failed", {
            path: req.path,          // which endpoint was called
            method: req.method,      // GET, POST etc
            errors: errors.array(),  // the actual validation errors
            ip: req.ip               // who sent the request
        });

        return res.status(400).json({ errors: errors.array() });
    }
    next();
}

// In-memory session store — stores conversation history per session
// Simple object where key is sessionId, value is messages array
// loads existing sessions from file on startup
const sessions = loadSessions();
logger.info("Sessions loaded", { count: Object.keys(sessions).length });

// POST /chat endpoint
// validateChat and checkValidation run before your route handler
/*Notice the route now has **4 handlers in sequence**:
validateChat → checkValidation → your logic → error handler*/
app.post("/chat", chatLimiter, validateChat, checkValidation, async (req, res, next) => {
    try {
        const { sessionId, message } = req.body;
        // no need to check for missing fields anymore — validation handles it

        if (!sessions[sessionId] || sessions[sessionId].documentVersion !== DOCUMENT_VERSION) {
            // create fresh session or reset outdated one
            sessions[sessionId] = {
                documentVersion: DOCUMENT_VERSION,  // track which version this session uses
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant. Always use available tools to fetch fresh information. Never rely on previous failed attempts — the knowledge base may have been updated."
                    }
                ]
            };
        }


        // note: now accessing .messages instead of session directly
        sessions[sessionId].messages.push({ role: "user", content: message });
        const reply = await runAgent(sessions[sessionId].messages);

        console.log("Reply:", reply);

        sessions[sessionId].messages.push({ role: "assistant", content: reply });
        saveSessions(sessions); // ← persist to file
        res.status(200).json({ reply });

    } catch (error) {
        next(error);
    }
});

// DELETE /chat/:sessionId — clears a specific session
// :sessionId is a URL parameter — accessible via req.params.sessionId
app.delete("/chat/:sessionId", (req, res) => {
    const { sessionId } = req.params;
    if (!sessions[sessionId]) {
        return res.status(404).json({ error: "Session not found" });
    }
    delete sessions[sessionId];
    saveSessions(sessions);
    res.status(200).json({ message: `Session ${sessionId} cleared` });
});

// GET /sessions — lists all active sessions
app.get("/sessions", (req, res) => {
    try {
        const activeSessions = Object.keys(sessions).map(sessionId => ({
            sessionId,
            documentVersion: sessions[sessionId].documentVersion,
            messageCount: sessions[sessionId].messages.length - 1
        }));
        res.status(200).json({ sessions: activeSessions });
    } catch (error) {
        next(error);
    }
});

// Order matters in Express
// Four parameters = Express treats this as error handler
app.use((err, req, res, next) => {
    logger.error("Unhandled error", {
        message: err.message,
        stack: err.stack  // full error trace
    });
    res.status(500).json({ error: "Internal server error" });
});

// Start server on port 3000
app.listen(3000, () => {
    logger.info("Server running on http://localhost:3000");
});