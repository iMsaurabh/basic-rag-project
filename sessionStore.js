import fs from "fs";
import logger from "./logger.js";

const SESSIONS_FILE = "./sessions.json";

// Load all sessions from file into memory on startup
export function loadSessions() {
    try {
        if (!fs.existsSync(SESSIONS_FILE)) {
            return {}; // no file yet — return empty object
        }
        const data = fs.readFileSync(SESSIONS_FILE, "utf8");
        // JSON.parse converts the file string back to a JS object
        return JSON.parse(data);
    } catch (error) {
        logger.error("Failed to load sessions", { message: error.message });
        return {};
    }
}

// Save all sessions to file
export function saveSessions(sessions) {
    try {
        // JSON.stringify converts JS object to string for file storage
        // null, 2 = pretty print with 2 space indentation — readable format
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    } catch (error) {
        logger.error("Failed to save sessions", { message: error.message });
    }
}