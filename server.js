import "dotenv/config";
import express from "express";
import { runAgent } from "./agent.js";
// body is a function that validates fields in req.body
// validationResult collects all validation errors
import { body, validationResult } from "express-validator";
import rateLimit from "express-rate-limit";

import morgan from "morgan";
import logger from "./utils/logger.js";

import {
    PORT,
    DOCUMENT_VERSION,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX,
    MAX_MESSAGE_LENGTH,
    MAX_SESSION_ID_LENGTH
} from "./config.js";

// below is remoed as we are using redis now
//import { loadSessions, saveSessions } from "./sessionStore.js";

import {
    saveSession,
    loadSession,
    deleteSession,
    listSessions
} from "./services/redisStore.js";

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
// Update your rate limiter to use config values
const chatLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
    message: { error: "Too many chat requests, please wait a minute" },
    standardHeaders: true,
    legacyHeaders: false
});

// Global limiter — apply before all routes
app.use(globalLimiter);

// Array of validation rules for /chat endpoint
const validateChat = [
    body("sessionId")
        .isString()
        .trim()
        .notEmpty()
        .withMessage("sessionId is required")
        .isLength({ max: MAX_SESSION_ID_LENGTH })
        .withMessage("sessionId too long"),

    body("message")
        .isString()
        .trim()
        .notEmpty()
        .withMessage("message is required")
        .isLength({ min: 1, max: MAX_MESSAGE_LENGTH })
        .withMessage(`message must be between 1 and ${MAX_MESSAGE_LENGTH} characters`),
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
// const sessions = loadSessions(); -> no longer applicable for redis
logger.info("Server started, using Redis for session storage");

// POST /chat endpoint
// validateChat and checkValidation run before your route handler
/*Notice the route now has **4 handlers in sequence**:
validateChat → checkValidation → your logic → error handler*/
app.post("/chat", chatLimiter, validateChat, checkValidation, async (req, res, next) => {
    try {
        const { sessionId, message } = req.body;

        // Load session from Redis instead of memory
        let session = await loadSession(sessionId);

        if (!session || session.documentVersion !== DOCUMENT_VERSION) {
            session = {
                documentVersion: DOCUMENT_VERSION,
                messages: [
                    { role: "system", content: "You are a helpful assistant. Always use available tools to fetch fresh information." }
                ]
            };
        }

        session.messages.push({ role: "user", content: message });
        const reply = await runAgent(session.messages);
        session.messages.push({ role: "assistant", content: reply });

        // Save updated session back to Redis
        await saveSession(sessionId, session);

        res.status(200).json({ reply });

    } catch (error) {
        next(error);
    }
});

// DELETE /chat/:sessionId — clears a specific session
// :sessionId is a URL parameter — accessible via req.params.sessionId
app.delete("/chat/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    await deleteSession(sessionId);
    res.status(200).json({ message: `Session ${sessionId} cleared` });
});

// GET /sessions — lists all active sessions
app.get("/sessions", async (req, res) => {
    const sessionIds = await listSessions();
    res.status(200).json({
        sessions: sessionIds.map(id => ({ sessionId: id })),
        count: sessionIds.length
    });
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

// Simple endpoint that returns 200 OK
// Render uses this to verify your app is running
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString()
    });
});

// GET /admin/status — system health overview
app.get("/admin/status", async (req, res) => {
    const sessionIds = await listSessions();

    res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
        documentVersion: DOCUMENT_VERSION,
        activeSessions: sessionIds.length,
        uptime: Math.floor(process.uptime()),  // seconds since server started
        memory: {
            // process.memoryUsage() returns memory stats in bytes
            // divide by 1024 twice to convert to MB
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            unit: "MB"
        }
    });
});

// POST /admin/clear-all-sessions — wipe all sessions
app.post("/admin/clear-all-sessions", async (req, res) => {
    const sessionIds = await listSessions();

    for (const sessionId of sessionIds) {
        await deleteSession(sessionId);
    }

    logger.info("All sessions cleared", { count: sessionIds.length });
    res.status(200).json({
        message: "All sessions cleared",
        cleared: sessionIds.length
    });
});

// process.env.PORT is set by Render in production
// falls back to 3000 for local development
app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));