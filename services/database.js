import Database from "better-sqlite3";
import logger from "../utils/logger.js";

// Creates database file if it doesn't exist
// SQLite stores everything in one file — no server needed
const db = new Database("./data/app.db");

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