"use strict";
// ==========================================
// Menu Service (Categories + Items)
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.menuService = void 0;
const database_1 = __importDefault(require("../../config/database"));
const logger_1 = require("../../utils/logger");
const department_routing_1 = require("../../utils/department-routing");
exports.menuService = {
    // ─── Categories ─────────────────────────
    async getCategories(tenantId, onlyActive = false) {
        return database_1.default.menuCategory.findMany({
            where: {
                tenantId,
                ...(onlyActive ? { isActive: true } : {})
            },
            include: {
                items: {
                    where: onlyActive ? { isActive: true } : {},
                    orderBy: { sortOrder: 'asc' }
                }
            },
            orderBy: { sortOrder: 'asc' },
        });
    },
    async createCategory(tenantId, data) {
        const category = await database_1.default.menuCategory.create({
            data: { tenantId, ...data },
        });
        logger_1.logger.info(`Category created: ${category.name} (tenant: ${tenantId})`);
        return category;
    },
    async updateCategory(tenantId, id, data) {
        const category = await database_1.default.menuCategory.findFirst({ where: { id, tenantId }, select: { id: true } });
        if (!category)
            throw Object.assign(new Error('Category not found'), { statusCode: 404 });
        return database_1.default.menuCategory.update({
            where: { id: category.id },
            data,
        });
    },
    async deleteCategory(tenantId, id) {
        const category = await database_1.default.menuCategory.findFirst({ where: { id, tenantId }, select: { id: true } });
        if (!category)
            throw Object.assign(new Error('Category not found'), { statusCode: 404 });
        return database_1.default.menuCategory.delete({ where: { id: category.id } });
    },
    async reorderCategories(tenantId, orderedIds) {
        const transaction = orderedIds.map((id, index) => database_1.default.menuCategory.updateMany({
            where: { id, tenantId },
            data: { sortOrder: index },
        }));
        await database_1.default.$transaction(transaction);
        return { success: true };
    },
    // ─── Menu Items ─────────────────────────
    async getItems(tenantId, categoryId, onlyActive = false) {
        const items = await database_1.default.menuItem.findMany({
            where: {
                tenantId,
                ...(categoryId ? { categoryId } : {}),
                ...(onlyActive ? { isActive: true } : {})
            },
            include: { category: { select: { id: true, name: true } } },
            orderBy: { sortOrder: 'asc' },
        });
        return items.map((item) => ({
            ...item,
            department: (0, department_routing_1.resolvePreparationDepartment)(item.department, item.category.name),
        }));
    },
    async getItemById(tenantId, id) {
        return database_1.default.menuItem.findFirst({
            where: { id, tenantId },
            include: {
                category: { select: { id: true, name: true } },
                recipes: { include: { ingredients: true } },
            },
        });
    },
    async createItem(tenantId, data) {
        let department = data.department;
        if (!department) {
            const category = await database_1.default.menuCategory.findFirst({
                where: { id: data.categoryId, tenantId },
                select: { name: true },
            });
            department = (0, department_routing_1.resolvePreparationDepartment)('KITCHEN', category?.name);
        }
        const item = await database_1.default.menuItem.create({
            data: {
                tenantId,
                categoryId: data.categoryId,
                name: data.name,
                description: data.description,
                basePrice: data.basePrice,
                portionOptions: data.portionOptions ?? [],
                extras: data.extras ?? [],
                department: department,
                preparationTime: data.preparationTime,
                calories: data.calories,
                allergens: data.allergens ?? [],
                extraInfo: data.extraInfo,
                badge: data.badge,
                image: data.image,
            },
        });
        logger_1.logger.info(`Menu item created: ${item.name} (${item.basePrice} TL)`);
        return item;
    },
    async updateItem(tenantId, id, data) {
        const item = await database_1.default.menuItem.findFirst({ where: { id, tenantId }, select: { id: true } });
        if (!item)
            throw Object.assign(new Error('Menu item not found'), { statusCode: 404 });
        return database_1.default.menuItem.update({ where: { id: item.id }, data: data });
    },
    async deleteItem(tenantId, id) {
        const item = await database_1.default.menuItem.findFirst({ where: { id, tenantId }, select: { id: true } });
        if (!item)
            throw Object.assign(new Error('Menu item not found'), { statusCode: 404 });
        return database_1.default.menuItem.delete({ where: { id: item.id } });
    },
};
//# sourceMappingURL=menu.service.js.map