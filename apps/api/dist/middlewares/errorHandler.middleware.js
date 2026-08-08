"use strict";
// ==========================================
// Global Error Handler Middleware
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const zod_1 = require("zod");
const logger_1 = require("../utils/logger");
function errorHandler(err, _req, res, _next) {
    logger_1.logger.error(`${err.name}: ${err.message}`);
    // Zod validation errors
    if (err instanceof zod_1.ZodError) {
        res.status(400).json({
            success: false,
            message: 'Validation error',
            errors: err.errors.map((e) => ({
                field: e.path.join('.'),
                message: e.message,
            })),
            timestamp: new Date().toISOString(),
        });
        return;
    }
    // Prisma known errors
    if (err.name === 'PrismaClientKnownRequestError') {
        const prismaErr = err;
        switch (prismaErr.code) {
            case 'P2002':
                res.status(409).json({
                    success: false,
                    message: 'A record with this data already exists.',
                    errors: prismaErr.meta,
                    timestamp: new Date().toISOString(),
                });
                return;
            case 'P2025':
                res.status(404).json({
                    success: false,
                    message: 'Record not found.',
                    timestamp: new Date().toISOString(),
                });
                return;
            default:
                res.status(500).json({
                    success: false,
                    message: err.message, // Temporarily show error in prod for debugging
                    // @ts-expect-error accessing dynamic property
                    ...(err.errors && { errors: err.errors }),
                    timestamp: new Date().toISOString(),
                });
                return;
        }
    }
    const requestedStatus = err.statusCode;
    const statusCode = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
        ? requestedStatus
        : 500;
    res.status(statusCode).json({
        success: false,
        message: err.message,
        timestamp: new Date().toISOString(),
    });
}
//# sourceMappingURL=errorHandler.middleware.js.map