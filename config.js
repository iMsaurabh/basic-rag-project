// Bump this number every time you re-run ingest.js
// This invalidates all existing sessions automatically
// config.js
import fs from "fs";

const stats = fs.statSync("./document.txt");
// stats.mtimeMs = last modified time in milliseconds
// unique number that changes automatically whenever document.txt is saved
export const DOCUMENT_VERSION = stats.mtimeMs;

export const MAX_ITERATIONS = 10;
export const MAX_HISTORY = 10;
export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_SESSION_ID_LENGTH = 50;
export const SESSIONS_FILE = "./sessions.json";