import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import db from "./database.js";
import { deleteSession } from "./redisStore.js";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "24h";

export async function registerUser(email, password) {
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
        throw new Error("Email already registered");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = db.prepare(
        "INSERT INTO users (email, password) VALUES (?, ?)"
    ).run(email, hashedPassword);

    const userId = result.lastInsertRowid;

    // Clear any existing session for this user ID
    await deleteSession(`${userId}:session-${userId}`);

    return generateToken({ id: userId, email });
}

export async function loginUser(email, password) {
    // Find user by email
    // .get() returns one row or undefined
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

    if (!user) {
        throw new Error("Invalid email or password");
    }

    // Compare plain password with hashed version
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
        throw new Error("Invalid email or password");
    }

    return generateToken({ id: user.id, email: user.email, plan: user.plan });
}

function generateToken(payload) {
    // jwt.sign(data, secret, options)
    // Creates a signed token that expires in JWT_EXPIRES
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token) {
    // jwt.verify throws if token is invalid or expired
    return jwt.verify(token, JWT_SECRET);
}