import db from "./database.js";

const FREE_LIMIT = parseInt(process.env.FREE_LIMIT) || 50;

// Get today's date as YYYY-MM-DD string
function today() {
    return new Date().toISOString().split("T")[0];
}

export function checkUsageLimit(userId, plan) {
    // Pro users have no limit
    if (plan === "pro") return { allowed: true, remaining: Infinity };

    // Get today's message count for this user
    const row = db.prepare(
        "SELECT count FROM usage WHERE user_id = ? AND date = ?"
    ).get(userId, today());

    const count = row?.count || 0;
    const remaining = FREE_LIMIT - count;

    return {
        allowed: remaining > 0,
        remaining,
        limit: FREE_LIMIT
    };
}

export function incrementUsage(userId) {
    // INSERT or UPDATE usage count for today
    // ON CONFLICT = if row exists, increment count instead
    db.prepare(`
        INSERT INTO usage (user_id, date, count) VALUES (?, ?, 1)
        ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1
    `).run(userId, today());
}

export function getUserUsage(userId) {
    const row = db.prepare(
        "SELECT count FROM usage WHERE user_id = ? AND date = ?"
    ).get(userId, today());
    return row?.count || 0;
}