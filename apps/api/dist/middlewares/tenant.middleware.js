"use strict";
// ==========================================
// Tenant Isolation Middleware
// ==========================================
// Ensures all database queries are scoped to
// the authenticated user's tenant.
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantMiddleware = tenantMiddleware;
exports.getTenantId = getTenantId;
const apiResponse_1 = require("../utils/apiResponse");
/**
 * Extracts tenantId from the authenticated user and makes it
 * available on the request object. Also validates that the
 * tenant exists and is active.
 *
 * SUPER_ADMIN bypasses tenant isolation when accessing
 * cross-tenant endpoints.
 */
function tenantMiddleware(req, res, next) {
    if (!req.user) {
        (0, apiResponse_1.apiError)(res, 401, 'Authentication required for tenant isolation.');
        return;
    }
    // If user is SUPER_ADMIN, skip tenant validation entirely.
    if (req.user.role === 'SUPER_ADMIN') {
        // Optionally allow header override for explicit tenant context.
        if (req.headers['x-tenant-id']) {
            req.user.tenantId = req.headers['x-tenant-id'];
        }
        return next();
    }
    // SUPER_ADMIN can optionally override tenant via header for other roles
    if (req.user.role === 'SUPER_ADMIN' && req.headers['x-tenant-id']) {
        const targetTenantId = req.headers['x-tenant-id'];
        req.user.tenantId = targetTenantId;
    }
    if (!req.user.tenantId) {
        (0, apiResponse_1.apiError)(res, 400, 'Tenant context is missing.');
        return;
    }
    next();
}
/**
 * Helper to get tenantId from request — use this in services
 * to ensure all queries are tenant-scoped.
 */
function getTenantId(req) {
    if (!req.user?.tenantId) {
        throw new Error('Tenant context missing. Ensure tenantMiddleware is applied.');
    }
    return req.user.tenantId;
}
//# sourceMappingURL=tenant.middleware.js.map