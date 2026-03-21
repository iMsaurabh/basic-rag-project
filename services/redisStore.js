import Redis from "ioredis";
import logger from "../utils/logger.js";

// ioredis automatically connects to Redis
// REDIS_URL from environment or default local connection
//dont this (below one)
//const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

logger.info("Connecting to Redis", {
    url: process.env.REDIS_URL ? "env var found" : "using default redis://redis:6379"
});
// Correct — use service name from docker-compose.yml
const redis = new Redis(process.env.REDIS_URL || "redis://redis:6379", {
    // Required for Upstash TLS connection
    tls: process.env.REDIS_URL?.startsWith("rediss://") ? {} : undefined
});

redis.on("connect", () => logger.info("Redis connected"));
redis.on("error", (err) => logger.error("Redis error", { message: err.message }));

// Save session to Redis
// JSON.stringify converts object to string for storage
// Sessions expire after 24 hours (86400 seconds)
export async function saveSession(sessionId, session) {
    await redis.setex(
        `session:${sessionId}`,  // key — prefix with "session:" for organization
        86400,                    // TTL in seconds — session expires after 24 hours
        JSON.stringify(session)   // value — must be string
    );
}

// Load session from Redis
export async function loadSession(sessionId) {
    const data = await redis.get(`session:${sessionId}`);
    if (!data) return null;
    return JSON.parse(data);  // convert string back to object
}

// Delete session from Redis
export async function deleteSession(sessionId) {
    await redis.del(`session:${sessionId}`);
}

// List all sessions
// KEYS pattern matching — "session:*" finds all session keys
export async function listSessions() {
    const keys = await redis.keys("session:*");
    return keys.map(key => key.replace("session:", ""));
}

export default redis;