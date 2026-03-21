import fs from "fs";

// Document version — auto generated from file modified time
const stats = fs.existsSync("./document.txt")
    ? fs.statSync("./document.txt")
    : { mtimeMs: 1 };

export const DOCUMENT_VERSION = stats.mtimeMs;

// Server
export const PORT = process.env.PORT || 3000;

// Agent
export const MAX_ITERATIONS = parseInt(process.env.MAX_ITERATIONS) || 10;
export const MAX_HISTORY = parseInt(process.env.MAX_HISTORY) || 10;

// Validation
export const MAX_MESSAGE_LENGTH = parseInt(process.env.MAX_MESSAGE_LENGTH) || 1000;
export const MAX_SESSION_ID_LENGTH = parseInt(process.env.MAX_SESSION_ID_LENGTH) || 50;

// Rate limiting
export const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
export const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 10;

// Redis
export const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";

// Session
export const SESSION_TTL = parseInt(process.env.SESSION_TTL) || 86400;

// Files
export const SESSIONS_FILE = "./sessions.json";
export const LOGS_DIR = "./logs";

// Detect environment
export const NODE_ENV = process.env.NODE_ENV || "development";
export const IS_PRODUCTION = NODE_ENV === "production";

export const LOG_LEVEL = IS_PRODUCTION ? "info" : "debug";