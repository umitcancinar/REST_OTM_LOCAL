"use strict";
// ==========================================
// Staff Service — Business Logic
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const database_1 = __importDefault(require("../../config/database"));
const logger_1 = require("../../utils/logger");
exports.staffService = {
    async findAll(tenantId) {
        return database_1.default.user.findMany({
            where: { tenantId, role: { in: ['WAITER', 'CHEF', 'CASHIER', 'ADMIN', 'OWNER'] }, isActive: true },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                lastLoginAt: true,
                createdAt: true,
            },
            orderBy: [{ role: 'asc' }, { name: 'asc' }],
        });
    },
    async create(tenantId, data) {
        // Check email uniqueness within tenant
        const existing = await database_1.default.user.findFirst({
            where: { tenantId, email: data.email.toLowerCase() },
        });
        if (existing) {
            throw Object.assign(new Error('Bu e-posta adresi zaten kullanılıyor.'), { statusCode: 409 });
        }
        const passwordHash = await bcryptjs_1.default.hash(data.password, 10);
        const pinHash = data.pin ? await bcryptjs_1.default.hash(data.pin.trim(), 10) : undefined;
        const role = data.role || 'WAITER';
        const user = await database_1.default.user.create({
            data: {
                tenantId,
                email: data.email.toLowerCase(),
                name: data.name,
                passwordHash,
                role,
                pin: pinHash,
                isActive: true,
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                createdAt: true,
            },
        });
        logger_1.logger.info(`Staff created: ${user.email} (${user.role}) in tenant ${tenantId}`);
        return user;
    },
    async update(tenantId, userId, data) {
        const existing = await database_1.default.user.findFirst({ where: { id: userId, tenantId } });
        if (!existing) {
            throw Object.assign(new Error('Personel bulunamadı.'), { statusCode: 404 });
        }
        const updateData = {};
        if (data.name)
            updateData.name = data.name;
        if (data.email)
            updateData.email = data.email.toLowerCase();
        if (data.role)
            updateData.role = data.role;
        if (data.isActive !== undefined)
            updateData.isActive = data.isActive;
        if (data.password) {
            updateData.passwordHash = await bcryptjs_1.default.hash(data.password, 10);
        }
        if (data.pin !== undefined) {
            updateData.pin = data.pin === '' ? null : await bcryptjs_1.default.hash(data.pin.trim(), 10);
        }
        const updated = await database_1.default.user.update({
            where: { id: userId },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                lastLoginAt: true,
                createdAt: true,
            },
        });
        logger_1.logger.info(`Staff updated: ${updated.email} in tenant ${tenantId}`);
        return updated;
    },
    async remove(tenantId, userId) {
        const existing = await database_1.default.user.findFirst({ where: { id: userId, tenantId } });
        if (!existing) {
            throw Object.assign(new Error('Personel bulunamadı.'), { statusCode: 404 });
        }
        // Soft-delete: deactivate instead of hard delete to preserve order history
        await database_1.default.user.update({
            where: { id: userId },
            data: { isActive: false },
        });
        logger_1.logger.info(`Staff deactivated: ${existing.email} in tenant ${tenantId}`);
        return { success: true };
    },
};
//# sourceMappingURL=staff.service.js.map