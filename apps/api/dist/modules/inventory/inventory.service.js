"use strict";
// ==========================================
// Inventory & Recipe Service
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inventoryService = void 0;
const database_1 = __importDefault(require("../../config/database"));
const logger_1 = require("../../utils/logger");
exports.inventoryService = {
    // ─── Inventory Items ────────────────────
    async findAll(tenantId) {
        return database_1.default.inventoryItem.findMany({
            where: { tenantId },
            orderBy: { name: 'asc' },
        });
    },
    async findById(tenantId, id) {
        return database_1.default.inventoryItem.findFirst({ where: { id, tenantId } });
    },
    async create(tenantId, data) {
        return database_1.default.inventoryItem.create({
            data: { tenantId, ...data },
        });
    },
    async update(tenantId, id, data) {
        return database_1.default.inventoryItem.update({ where: { id, tenantId }, data: data });
    },
    async delete(tenantId, id) {
        return database_1.default.inventoryItem.delete({ where: { id, tenantId } });
    },
    /** Check and return items below minimum stock threshold */
    async getStockAlerts(tenantId) {
        const items = await database_1.default.inventoryItem.findMany({
            where: { tenantId, isActive: true },
        });
        return items
            .filter((item) => item.currentStock <= item.minStockAlert)
            .map((item) => ({
            inventoryItemId: item.id,
            itemName: item.name,
            currentStock: item.currentStock,
            minStockAlert: item.minStockAlert,
            unit: item.unit,
            severity: item.currentStock <= 0 ? 'critical' : 'warning',
        }));
    },
    // ─── Recipes ────────────────────────────
    async getRecipe(tenantId, menuItemId) {
        return database_1.default.recipe.findFirst({
            where: { tenantId, menuItemId },
            include: {
                ingredients: {
                    include: { inventoryItem: { select: { name: true, unit: true, currentStock: true } } },
                },
            },
        });
    },
    async createRecipe(tenantId, data) {
        return database_1.default.recipe.create({
            data: {
                tenantId,
                menuItemId: data.menuItemId,
                ingredients: {
                    create: data.ingredients.map((ing) => ({
                        inventoryItemId: ing.inventoryItemId,
                        quantity: ing.quantity,
                        unit: ing.unit,
                    })),
                },
            },
            include: { ingredients: true },
        });
    },
    /**
     * Deduct stock based on sold items.
     * Called when an order is CONFIRMED.
     */
    async deductStockForOrder(tenantId, orderItems) {
        await database_1.default.$transaction(async (tx) => {
            for (const item of orderItems) {
                const recipe = await tx.recipe.findFirst({
                    where: { tenantId, menuItemId: item.menuItemId },
                    include: { ingredients: true },
                });
                if (!recipe)
                    continue; // No recipe defined, skip
                for (const ingredient of recipe.ingredients) {
                    const deductAmount = ingredient.quantity * item.quantity * item.portionMultiplier;
                    await tx.inventoryItem.update({
                        where: { id: ingredient.inventoryItemId, tenantId },
                        data: {
                            currentStock: { decrement: deductAmount },
                        },
                    });
                    logger_1.logger.debug(`Stock deducted: ${ingredient.inventoryItemId} -= ${deductAmount}`);
                }
            }
        });
    },
    // ─── Waste Logs ─────────────────────────
    async getWasteLogs(tenantId) {
        return database_1.default.wasteLog.findMany({
            where: { tenantId },
            include: {
                inventoryItem: { select: { name: true, unit: true } },
                loggedBy: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
    },
    async createWasteLog(tenantId, data) {
        return database_1.default.$transaction(async (tx) => {
            // Deduct from stock
            await tx.inventoryItem.update({
                where: { id: data.inventoryItemId, tenantId },
                data: { currentStock: { decrement: data.quantity } },
            });
            return tx.wasteLog.create({
                data: { tenantId, ...data },
            });
        });
    },
};
//# sourceMappingURL=inventory.service.js.map