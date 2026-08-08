"use strict";
// ==========================================
// JWT Authentication Middleware
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const apiResponse_1 = require("../utils/apiResponse");
function authMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            (0, apiResponse_1.apiError)(res, 401, 'Access denied. No token provided.');
            return;
        }
        const token = authHeader.split(' ')[1];
        if (!token) {
            (0, apiResponse_1.apiError)(res, 401, 'Access denied. Invalid token format.');
            return;
        }
        const decoded = jsonwebtoken_1.default.verify(token, env_1.env.JWT_ACCESS_SECRET);
        req.user = {
            userId: decoded.userId,
            tenantId: decoded.tenantId,
            role: decoded.role,
        };
        next();
    }
    catch (error) {
        if (error instanceof jsonwebtoken_1.default.TokenExpiredError) {
            (0, apiResponse_1.apiError)(res, 401, 'Token expired. Please refresh your token.');
            return;
        }
        if (error instanceof jsonwebtoken_1.default.JsonWebTokenError) {
            (0, apiResponse_1.apiError)(res, 401, 'Invalid token.');
            return;
        }
        (0, apiResponse_1.apiError)(res, 500, 'Internal authentication error.');
    }
}
//# sourceMappingURL=auth.middleware.js.map