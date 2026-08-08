"use strict";
// ==========================================
// Zod Validation Helpers
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.validators = exports.idParamSchema = exports.paginationSchema = void 0;
const zod_1 = require("zod");
/** Reusable pagination query schema */
exports.paginationSchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
    sortBy: zod_1.z.string().optional(),
    sortOrder: zod_1.z.enum(['asc', 'desc']).default('desc'),
});
/** CUID ID param validator */
exports.idParamSchema = zod_1.z.object({
    id: zod_1.z.string().min(1, 'ID is required'),
});
/** Common string validators */
exports.validators = {
    email: zod_1.z.string().email('Invalid email address'),
    password: zod_1.z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number'),
    pin: zod_1.z.string().length(4, 'PIN must be exactly 4 digits').regex(/^\d+$/, 'PIN must be numeric'),
    phone: zod_1.z.string().regex(/^[\d\s\-+()]+$/, 'Invalid phone number').optional(),
    slug: zod_1.z
        .string()
        .min(2)
        .max(50)
        .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
    positiveNumber: zod_1.z.number().positive(),
    nonNegativeNumber: zod_1.z.number().min(0),
};
//# sourceMappingURL=validators.js.map