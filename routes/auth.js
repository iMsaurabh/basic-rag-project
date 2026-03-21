import express from "express";
import { body, validationResult } from "express-validator";
import { registerUser, loginUser } from "../services/auth.js";
import logger from "../utils/logger.js";

const router = express.Router();
// router = mini Express app for a specific set of routes
// keeps routes organized and separate from server.js

const validateAuth = [
    body("email")
        .isEmail()
        .withMessage("Valid email required")
        .normalizeEmail(), // converts to lowercase, removes dots in gmail

    body("password")
        .isLength({ min: 6 })
        .withMessage("Password must be at least 6 characters")
];

function checkValidation(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
}

// POST /auth/register
router.post("/register", validateAuth, checkValidation, async (req, res) => {
    try {
        const { email, password } = req.body;
        const token = await registerUser(email, password);
        logger.info("User registered", { email });
        res.status(201).json({ token });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// POST /auth/login
router.post("/login", validateAuth, checkValidation, async (req, res) => {
    try {
        const { email, password } = req.body;
        const token = await loginUser(email, password);
        logger.info("User logged in", { email });
        res.status(200).json({ token });
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

export default router;