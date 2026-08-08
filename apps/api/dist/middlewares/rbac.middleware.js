"use strict";
// ==========================================
// Role-Based Access Control (RBAC) Middleware
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.rbac = rbac;
exports.minRole = minRole;
const apiResponse_1 = require("../utils/apiResponse");
/**
 * Role hierarchy (higher index = more permissions):
 * WAITER < CASHIER < CHEF < OWNER < SUPER_ADMIN
 */
const ROLE_HIERARCHY = {
    WAITER: 1,
    CASHIER: 2,
    CHEF: 3,
    ADMIN: 4,
    OWNER: 5,
    SUPER_ADMIN: 6,
};
/**
 * Restrict access to users with one of the allowed roles.
 * Usage: router.get('/admin', authMiddleware, rbac('OWNER', 'SUPER_ADMIN'), handler)
 */
function rbac(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            (0, apiResponse_1.apiError)(res, 401, 'Authentication required.');
            return;
        }
        if (!allowedRoles.includes(req.user.role)) {
            (0, apiResponse_1.apiError)(res, 403, `Access denied. Required roles: ${allowedRoles.join(', ')}`);
            return;
        }
        next();
    };
}
/**
 * Restrict access to users with at least the minimum role level.
 * Usage: router.get('/reports', authMiddleware, minRole('CHEF'), handler)
 */
function minRole(minimumRole) {
    return (req, res, next) => {
        if (!req.user) {
            (0, apiResponse_1.apiError)(res, 401, 'Authentication required.');
            return;
        }
        const userLevel = ROLE_HIERARCHY[req.user.role] || 0;
        const requiredLevel = ROLE_HIERARCHY[minimumRole] || 0;
        if (userLevel < requiredLevel) {
            (0, apiResponse_1.apiError)(res, 403, `Access denied. Minimum role required: ${minimumRole}`);
            return;
        }
        next();
    };
}
//# sourceMappingURL=rbac.middleware.js.map