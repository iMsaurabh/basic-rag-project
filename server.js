import "dotenv/config";
import express from "express";
import { runAgent } from "./agent.js";
// auth routes and middleware
import authRoutes from "./routes/auth.js";
import { requireAuth } from "./middleware/auth.js";
import { checkUsageLimit, incrementUsage, getUserUsage } from "./services/usage.js";
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

// 1. CORS FIRST — before everything else
app.use((req, res, next) => {
    const allowedOrigins = [
        "http://localhost:5173",
        process.env.FRONTEND_URL        // ← or use env variable
    ];

    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
    }

    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
        return res.sendStatus(200);
    }
    next();
});

// 2. JSON parsing
app.use(express.json());

// 3. Morgan logging
app.use(morgan("combined", {
    stream: {
        write: (message) => logger.info(message.trim())
    }
}));

// 4. Routes
app.use("/auth", authRoutes);

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


app.post("/chat", requireAuth, chatLimiter, validateChat, checkValidation, async (req, res, next) => {
    try {
        const { sessionId, message } = req.body;

        // Check usage limit before processing
        const usage = checkUsageLimit(req.user.id, req.user.plan);

        if (!usage.allowed) {
            return res.status(429).json({
                error: "Daily message limit reached",
                limit: usage.limit,
                remaining: 0,
                plan: req.user.plan,
                upgradeMessage: "Upgrade to Pro for unlimited messages"
            });
        }

        const userSessionId = `${req.user.id}:${sessionId}`;
        let session = await loadSession(userSessionId);

        if (!session || session.documentVersion !== DOCUMENT_VERSION) {
            session = {
                documentVersion: DOCUMENT_VERSION,
                messages: [
                    { role: "system", content: "You are a helpful assistant." }
                ]
            };
        }

        session.messages.push({ role: "user", content: message });
        const reply = await runAgent(session.messages);
        session.messages.push({ role: "assistant", content: reply });

        await saveSession(userSessionId, session);

        // Increment usage after successful response
        incrementUsage(req.user.id);

        // Include usage info in response
        res.status(200).json({
            reply,
            usage: {
                remaining: usage.remaining - 1,
                limit: usage.limit,
                plan: req.user.plan
            }
        });

    } catch (error) {
        next(error);
    }
});

// GET /usage — returns current usage info for the authenticated user
app.get("/usage", requireAuth, (req, res) => {
    const usage = checkUsageLimit(req.user.id, req.user.plan);
    const count = getUserUsage(req.user.id);

    res.status(200).json({
        plan: req.user.plan,
        messagesUsed: count,
        messagesRemaining: usage.remaining,
        limit: usage.limit,
        resetTime: "midnight UTC"
    });
});

// GET /debug/session — returns current session data for debugging
app.get("/debug/session", requireAuth, async (req, res) => {
    const userSessionId = `${req.user.id}:session-${req.user.id}`;
    const session = await loadSession(userSessionId);
    res.status(200).json({ session });
});

// DELETE /chat/:sessionId — clears a specific session
// :sessionId is a URL parameter — accessible via req.params.sessionId
app.delete("/chat/:sessionId", requireAuth, async (req, res) => {
    const { sessionId } = req.params;

    // Reconstruct the full key with userId prefix
    const userSessionId = `${req.user.id}:${sessionId}`;

    // This prevents user A from deleting user B's session
    // even if they know the sessionId
    await deleteSession(userSessionId);

    res.status(200).json({ message: `Session ${sessionId} cleared` });
});

// GET /sessions — lists all active sessions
app.get("/sessions", requireAuth, async (req, res) => {
    const allKeys = await listSessions();

    // Filter — only return sessions belonging to this user
    // Every key is stored as "userId:sessionId"
    // We only want keys that start with this user's ID
    const userSessions = allKeys
        .filter(key => key.startsWith(`${req.user.id}:`))
        .map(key => ({
            // Remove userId prefix before sending to client
            // "3:my-session" → "my-session"
            sessionId: key.split(":")[1],
            fullKey: key
        }));

    res.status(200).json({
        sessions: userSessions,
        count: userSessions.length
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

app.get("/chat/history", requireAuth, async (req, res) => {
    const userSessionId = `${req.user.id}:session-${req.user.id}`;
    const session = await loadSession(userSessionId);

    if (!session) {
        return res.status(200).json({ messages: [] });
    }

    const history = session.messages.filter(m =>
        // Only user messages with content
        (m.role === "user" && m.content) ||
        // Only assistant messages with text content (not tool_calls)
        (m.role === "assistant" && m.content && !m.tool_calls)
    );

    res.status(200).json({ messages: history });
});

// process.env.PORT is set by Render in production
// falls back to 3000 for local development
app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));