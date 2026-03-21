import { verifyToken } from "../services/auth.js";
import logger from "../utils/logger.js";

export function requireAuth(req, res, next) {
    // Get token from Authorization header
    // Header format: "Bearer eyJhbG..."
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
    }

    // Extract token — split "Bearer TOKEN" and take second part
    const token = authHeader.split(" ")[1];

    try {
        // Verify and decode token
        const decoded = verifyToken(token);

        // Attach user info to request — available in all route handlers
        req.user = decoded;

        next(); // token valid — proceed to route handler
    } catch (error) {
        logger.warn("Invalid token attempt", { error: error.message });
        return res.status(401).json({ error: "Invalid or expired token" });
    }
}