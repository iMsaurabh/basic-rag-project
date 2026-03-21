import Database from "better-sqlite3";
import fs from "fs";
import logger from "../utils/logger.js";

// Create data directory if it doesn't exist
// This runs before database connection
if (!fs.existsSync("./data")) {
    fs.mkdirSync("./data", { recursive: true });
    // recursive: true = creates parent directories too if needed
}

const db = new Database("./data/app.db");
// rest of your code stays the same

logger.info("Database connected");

// Enable WAL mode — better performance for concurrent reads
// WAL = Write Ahead Logging
db.pragma("journal_mode = WAL");

// Create users table if it doesn't exist
// IF NOT EXISTS — safe to run multiple times
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        email       TEXT UNIQUE NOT NULL,
        password    TEXT NOT NULL,
        plan        TEXT DEFAULT 'free',
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

logger.info("Database tables ready");

export default db;