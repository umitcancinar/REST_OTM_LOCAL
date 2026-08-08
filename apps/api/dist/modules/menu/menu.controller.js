"use strict";
// ==========================================
// Menu Controller
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.menuController = void 0;
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const menu_service_1 = require("./menu.service");
const apiResponse_1 = require("../../utils/apiResponse");
exports.menuController = {
    // ─── Categories ─────────────────────────
    async getCategories(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const includeInactive = req.query.includeInactive === 'true';
            const categories = await menu_service_1.menuService.getCategories(tenantId, !includeInactive);
            (0, apiResponse_1.apiResponse)({ res, data: categories });
        }
        catch (error) {
            next(error);
        }
    },
    async createCategory(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const category = await menu_service_1.menuService.createCategory(tenantId, req.body);
            (0, apiResponse_1.apiResponse)({ res, statusCode: 201, data: category, message: 'Category created' });
        }
        catch (error) {
            next(error);
        }
    },
    async updateCategory(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const category = await menu_service_1.menuService.updateCategory(tenantId, req.params.id, req.body);
            (0, apiResponse_1.apiResponse)({ res, data: category, message: 'Category updated' });
        }
        catch (error) {
            next(error);
        }
    },
    async deleteCategory(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            await menu_service_1.menuService.deleteCategory(tenantId, req.params.id);
            (0, apiResponse_1.apiResponse)({ res, message: 'Category deleted' });
        }
        catch (error) {
            next(error);
        }
    },
    async reorderCategories(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const { orderedIds } = req.body;
            if (!Array.isArray(orderedIds)) {
                return (0, apiResponse_1.apiError)(res, 400, 'orderedIds must be an array of category IDs');
            }
            await menu_service_1.menuService.reorderCategories(tenantId, orderedIds);
            (0, apiResponse_1.apiResponse)({ res, message: 'Categories reordered successfully' });
        }
        catch (error) {
            next(error);
        }
    },
    // ─── Menu Items ─────────────────────────
    async getItems(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const categoryId = req.query.categoryId;
            const includeInactive = req.query.includeInactive === 'true';
            const items = await menu_service_1.menuService.getItems(tenantId, categoryId, !includeInactive);
            (0, apiResponse_1.apiResponse)({ res, data: items });
        }
        catch (error) {
            next(error);
        }
    },
    async getItemById(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const item = await menu_service_1.menuService.getItemById(tenantId, req.params.id);
            if (!item) {
                (0, apiResponse_1.apiError)(res, 404, 'Menu item not found');
                return;
            }
            (0, apiResponse_1.apiResponse)({ res, data: item });
        }
        catch (error) {
            next(error);
        }
    },
    async createItem(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const item = await menu_service_1.menuService.createItem(tenantId, req.body);
            (0, apiResponse_1.apiResponse)({ res, statusCode: 201, data: item, message: 'Menu item created' });
        }
        catch (error) {
            next(error);
        }
    },
    async updateItem(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const item = await menu_service_1.menuService.updateItem(tenantId, req.params.id, req.body);
            (0, apiResponse_1.apiResponse)({ res, data: item, message: 'Menu item updated' });
        }
        catch (error) {
            next(error);
        }
    },
    async deleteItem(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            await menu_service_1.menuService.deleteItem(tenantId, req.params.id);
            (0, apiResponse_1.apiResponse)({ res, message: 'Menu item deleted' });
        }
        catch (error) {
            next(error);
        }
    },
};
//# sourceMappingURL=menu.controller.js.map