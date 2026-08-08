"use strict";
// ==========================================
// Standardized API Response Helper
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiResponse = apiResponse;
exports.apiError = apiError;
exports.paginatedResponse = paginatedResponse;
function apiResponse({ res, statusCode = 200, success = true, message = 'Success', data, meta, }) {
    return res.status(statusCode).json({
        success,
        message,
        data,
        meta,
        timestamp: new Date().toISOString(),
    });
}
function apiError(res, statusCode, message, errors) {
    return res.status(statusCode).json({
        success: false,
        message,
        errors,
        timestamp: new Date().toISOString(),
    });
}
/** Paginated response helper */
function paginatedResponse(res, data, total, page, limit) {
    return apiResponse({
        res,
        data,
        meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasMore: page * limit < total,
        },
    });
}
//# sourceMappingURL=apiResponse.js.map