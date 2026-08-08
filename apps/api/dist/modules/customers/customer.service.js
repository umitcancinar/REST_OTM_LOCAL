"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.customerService = void 0;
const database_1 = __importDefault(require("../../config/database"));
exports.customerService = {
    async findAll(tenantId, search) {
        const where = { tenantId };
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
            ];
        }
        return database_1.default.customer.findMany({
            where,
            orderBy: { updatedAt: 'desc' },
            include: {
                orders: {
                    where: { isDeleted: false },
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: {
                        id: true,
                        orderNumber: true,
                        createdAt: true,
                        grandTotal: true,
                        subChecks: {
                            select: {
                                items: {
                                    where: { status: { not: 'CANCELLED' } },
                                    select: { menuItemName: true, quantity: true },
                                    take: 5,
                                },
                            },
                        },
                    },
                },
            },
        });
    },
    async findById(tenantId, id) {
        return database_1.default.customer.findFirst({
            where: { tenantId, id },
        });
    },
    async create(tenantId, data) {
        return database_1.default.customer.create({
            data: {
                tenantId,
                ...data,
            },
        });
    },
    async update(tenantId, id, data) {
        return database_1.default.customer.update({
            where: { id, tenantId },
            data,
        });
    },
    async deleteAll(tenantId) {
        return database_1.default.customer.deleteMany({ where: { tenantId } });
    },
    async delete(tenantId, id) {
        return database_1.default.customer.delete({
            where: { id, tenantId },
        });
    },
};
//# sourceMappingURL=customer.service.js.map