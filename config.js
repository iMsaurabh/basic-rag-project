// Bump this number every time you re-run ingest.js
// This invalidates all existing sessions automatically
export const DOCUMENT_VERSION = 2;

export const MAX_ITERATIONS = 10;
export const MAX_HISTORY = 10;
export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_SESSION_ID_LENGTH = 50;
export const SESSIONS_FILE = "./sessions.json";