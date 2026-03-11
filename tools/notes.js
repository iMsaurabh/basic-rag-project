import fs from "fs";
// fs is Node.js built-in module for file system operations
// No need to install — it comes with Node.js

const NOTES_FILE = "./notes.txt";

export function saveNote({ note }) {
    // appendFileSync writes to file without deleting existing content
    // Sync means it blocks until done (no await needed)
    // "\n" adds a new line after each note
    try {
        fs.appendFileSync(NOTES_FILE, note + "\n");
        return `Note saved: "${note}"`;
    } catch (error) {
        return `Error saving note: ${error.message}`;
    }
}

export function readNotes() {
    try {
        // existsSync checks if file exists before reading
        if (!fs.existsSync(NOTES_FILE)) {
            return "No notes found.";
        }
        // readFileSync reads entire file as a string
        // "utf8" tells Node to return text instead of raw bytes
        const notes = fs.readFileSync(NOTES_FILE, "utf8");
        return `Your notes:\n${notes}`;
    } catch (error) {
        return `Error reading notes: ${error.message}`;
    }
}

export function deleteNotes() {
    try {
        if (!fs.existsSync(NOTES_FILE)) {
            return "No notes to delete.";
        }
        // writeFileSync with empty string overwrites file with nothing
        // This is safer than fs.unlinkSync which deletes the file entirely
        fs.writeFileSync(NOTES_FILE, "");
        return "All notes deleted.";
    } catch (error) {
        return `Error deleting notes: ${error.message}`;
    }
}