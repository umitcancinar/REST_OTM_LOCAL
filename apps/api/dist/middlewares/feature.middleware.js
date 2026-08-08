"use strict";
// ==========================================
// Feature Flag (Licensing) Middleware
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkFeature = void 0;
const apiResponse_1 = require("../utils/apiResponse");
const database_1 = __importDefault(require("../config/database"));
/**
 * Checks if a specific feature is enabled for the current tenant.
 * SUPER_ADMIN bypasses this check.
 */
const checkFeature = (featureKey) => {
    return async (req, res, next) => {
        if (!req.user) {
            return (0, apiResponse_1.apiError)(res, 401, 'Authentication required.');
        }
        // Super Admin bypasses feature checks
        if (req.user.role === 'SUPER_ADMIN') {
            return next();
        }
        try {
            const tenant = await database_1.default.tenant.findUnique({
                where: { id: req.user.tenantId },
                select: { settings: true }
            });
            if (!tenant) {
                return (0, apiResponse_1.apiError)(res, 404, 'Restaurant not found.');
            }
            const settings = typeof tenant.settings === 'string'
                ? JSON.parse(tenant.settings)
                : tenant.settings;
            const features = settings?.features || {
                website: true,
                reservations: true,
                takeaway: true,
                pos: true
            };
            if (!features[featureKey]) {
                return (0, apiResponse_1.apiError)(res, 403, `Bu modül (${featureKey}) lisansınızda tanımlı değil. Lütfen sistem yöneticisi ile iletişime geçin.`);
            }
            next();
        }
        catch (err) {
            console.error('Feature check error:', err);
            next(); // Fail-safe: allow if check fails? Or block? Let's allow for now to prevent breaking everything on small JSON errors.
        }
    };
};
exports.checkFeature = checkFeature;
//# sourceMappingURL=feature.middleware.js.map