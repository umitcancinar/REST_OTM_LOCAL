"use strict";
// ==========================================
// Table Controller
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.tableController = void 0;
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const table_service_1 = require("./table.service");
const apiResponse_1 = require("../../utils/apiResponse");
exports.tableController = {
    async getAll(req, res, next) {
        try {
            const tables = await table_service_1.tableService.findAll((0, tenant_middleware_1.getTenantId)(req));
            (0, apiResponse_1.apiResponse)({ res, data: tables });
        }
        catch (error) {
            next(error);
        }
    },
    async getById(req, res, next) {
        try {
            const table = await table_service_1.tableService.findById((0, tenant_middleware_1.getTenantId)(req), req.params.id);
            if (!table) {
                (0, apiResponse_1.apiError)(res, 404, 'Table not found');
                return;
            }
            (0, apiResponse_1.apiResponse)({ res, data: table });
        }
        catch (error) {
            next(error);
        }
    },
    async create(req, res, next) {
        try {
            const table = await table_service_1.tableService.create((0, tenant_middleware_1.getTenantId)(req), req.body);
            (0, apiResponse_1.apiResponse)({ res, statusCode: 201, data: table, message: 'Table created' });
        }
        catch (error) {
            next(error);
        }
    },
    async update(req, res, next) {
        try {
            const table = await table_service_1.tableService.update((0, tenant_middleware_1.getTenantId)(req), req.params.id, req.body);
            (0, apiResponse_1.apiResponse)({ res, data: table, message: 'Table updated' });
        }
        catch (error) {
            next(error);
        }
    },
    async delete(req, res, next) {
        try {
            await table_service_1.tableService.delete((0, tenant_middleware_1.getTenantId)(req), req.params.id);
            (0, apiResponse_1.apiResponse)({ res, message: 'Table deleted' });
        }
        catch (error) {
            next(error);
        }
    },
};
//# sourceMappingURL=table.controller.js.map