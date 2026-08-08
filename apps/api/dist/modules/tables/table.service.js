"use strict";
// ==========================================
// Table Service
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tableService = void 0;
const database_1 = __importDefault(require("../../config/database"));
exports.tableService = {
    async findAll(tenantId) {
        const tables = await database_1.default.restaurantTable.findMany({
            where: { tenantId },
            include: {
                orders: {
                    where: {
                        status: { notIn: ['COMPLETED', 'CANCELLED'] },
                        isDeleted: false
                    },
                    select: {
                        id: true,
                        status: true,
                        grandTotal: true
                    }
                }
            }
        });
        return tables.sort((a, b) => {
            const zoneA = a.zone || '';
            const zoneB = b.zone || '';
            if (zoneA !== zoneB) {
                return zoneA.localeCompare(zoneB);
            }
            return a.number.localeCompare(b.number, undefined, { numeric: true, sensitivity: 'base' });
        });
    },
    async findById(tenantId, id) {
        return database_1.default.restaurantTable.findFirst({ where: { id, tenantId } });
    },
    async create(tenantId, data) {
        return database_1.default.restaurantTable.create({
            data: { tenantId, ...data },
        });
    },
    async update(tenantId, id, data) {
        return database_1.default.restaurantTable.update({
            where: { id, tenantId },
            data: data,
        });
    },
    async updateStatus(tenantId, id, status) {
        return database_1.default.restaurantTable.update({
            where: { id, tenantId },
            data: { status: status },
        });
    },
    async delete(tenantId, id) {
        return database_1.default.restaurantTable.delete({ where: { id, tenantId } });
    },
};
//# sourceMappingURL=table.service.js.map