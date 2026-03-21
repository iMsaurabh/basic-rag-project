import winston from "winston";

import { LOG_LEVEL } from "../config.js";

// Custom format for files — controls field order
const fileFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, path, method, errors, ...meta }) => {
        // Build object in the exact order you want
        const log = {
            timestamp,
            path,
            method,
            message,
            errors,
            ...meta  // anything else like ip, stack etc
        };

        // Remove undefined fields — cleaner logs
        Object.keys(log).forEach(key => log[key] === undefined && delete log[key]);

        return JSON.stringify(log);
    })
);

const logger = winston.createLogger({
    level: LOG_LEVEL,

    // Default format for transports that don't specify their own
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),

    transports: [
        // Console transport — human readable with timestamp
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    return `${timestamp} ${level}: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ""}`;
                })
            )
        }),

        // Error log — only error level, custom field order
        new winston.transports.File({
            filename: "logs/error.log",
            level: "error",
            format: fileFormat  // defined above so no ReferenceError
        }),

        // Combined log — all levels, custom field order
        new winston.transports.File({
            filename: "logs/combined.log",
            format: fileFormat  // defined above so no ReferenceError
        })
    ]
});

export default logger;