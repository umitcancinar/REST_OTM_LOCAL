"use strict";
// ==========================================
// Inventory Controller
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.inventoryController = void 0;
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const inventory_service_1 = require("./inventory.service");
const apiResponse_1 = require("../../utils/apiResponse");
exports.inventoryController = {
    // ─── Inventory Items ────────────────────
    async getAll(req, res, next) {
        try {
            const items = await inventory_service_1.inventoryService.findAll((0, tenant_middleware_1.getTenantId)(req));
            (0, apiResponse_1.apiResponse)({ res, data: items });
        }
        catch (error) {
            next(error);
        }
    },
    async getById(req, res, next) {
        try {
            const item = await inventory_service_1.inventoryService.findById((0, tenant_middleware_1.getTenantId)(req), req.params.id);
            if (!item) {
                (0, apiResponse_1.apiError)(res, 404, 'Inventory item not found');
                return;
            }
            (0, apiResponse_1.apiResponse)({ res, data: item });
        }
        catch (error) {
            next(error);
        }
    },
    async create(req, res, next) {
        try {
            const item = await inventory_service_1.inventoryService.create((0, tenant_middleware_1.getTenantId)(req), req.body);
            (0, apiResponse_1.apiResponse)({ res, statusCode: 201, data: item, message: 'Inventory item created' });
        }
        catch (error) {
            next(error);
        }
    },
    async update(req, res, next) {
        try {
            const item = await inventory_service_1.inventoryService.update((0, tenant_middleware_1.getTenantId)(req), req.params.id, req.body);
            (0, apiResponse_1.apiResponse)({ res, data: item, message: 'Inventory item updated' });
        }
        catch (error) {
            next(error);
        }
    },
    async delete(req, res, next) {
        try {
            await inventory_service_1.inventoryService.delete((0, tenant_middleware_1.getTenantId)(req), req.params.id);
            (0, apiResponse_1.apiResponse)({ res, message: 'Inventory item deleted' });
        }
        catch (error) {
            next(error);
        }
    },
    async getStockAlerts(req, res, next) {
        try {
            const alerts = await inventory_service_1.inventoryService.getStockAlerts((0, tenant_middleware_1.getTenantId)(req));
            (0, apiResponse_1.apiResponse)({ res, data: alerts });
        }
        catch (error) {
            next(error);
        }
    },
    // ─── Recipes ────────────────────────────
    async getRecipe(req, res, next) {
        try {
            const recipe = await inventory_service_1.inventoryService.getRecipe((0, tenant_middleware_1.getTenantId)(req), req.params.menuItemId);
            if (!recipe) {
                (0, apiResponse_1.apiError)(res, 404, 'Recipe not found');
                return;
            }
            (0, apiResponse_1.apiResponse)({ res, data: recipe });
        }
        catch (error) {
            next(error);
        }
    },
    async createRecipe(req, res, next) {
        try {
            const recipe = await inventory_service_1.inventoryService.createRecipe((0, tenant_middleware_1.getTenantId)(req), req.body);
            (0, apiResponse_1.apiResponse)({ res, statusCode: 201, data: recipe, message: 'Recipe created' });
        }
        catch (error) {
            next(error);
        }
    },
    // ─── Waste Logs ─────────────────────────
    async getWasteLogs(req, res, next) {
        try {
            const logs = await inventory_service_1.inventoryService.getWasteLogs((0, tenant_middleware_1.getTenantId)(req));
            (0, apiResponse_1.apiResponse)({ res, data: logs });
        }
        catch (error) {
            next(error);
        }
    },
    async createWasteLog(req, res, next) {
        try {
            const log = await inventory_service_1.inventoryService.createWasteLog((0, tenant_middleware_1.getTenantId)(req), {
                ...req.body,
                loggedById: req.user.userId,
            });
            (0, apiResponse_1.apiResponse)({ res, statusCode: 201, data: log, message: 'Waste log created' });
        }
        catch (error) {
            next(error);
        }
    },
};
//# sourceMappingURL=inventory.controller.js.map