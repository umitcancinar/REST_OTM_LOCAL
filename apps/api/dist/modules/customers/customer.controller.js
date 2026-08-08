"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customerController = void 0;
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const customer_service_1 = require("./customer.service");
const apiResponse_1 = require("../../utils/apiResponse");
exports.customerController = {
    async getAll(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const search = req.query.search;
            const customers = await customer_service_1.customerService.findAll(tenantId, search);
            (0, apiResponse_1.apiResponse)({ res, data: customers });
        }
        catch (error) {
            next(error);
        }
    },
    async getById(req, res, next) {
        try {
            const customer = await customer_service_1.customerService.findById((0, tenant_middleware_1.getTenantId)(req), req.params.id);
            if (!customer) {
                (0, apiResponse_1.apiError)(res, 404, 'Customer not found');
                return;
            }
            (0, apiResponse_1.apiResponse)({ res, data: customer });
        }
        catch (error) {
            next(error);
        }
    },
    async create(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const customer = await customer_service_1.customerService.create(tenantId, req.body);
            (0, apiResponse_1.apiResponse)({ res, statusCode: 201, data: customer, message: 'Customer created' });
        }
        catch (error) {
            next(error);
        }
    },
    async update(req, res, next) {
        try {
            const customer = await customer_service_1.customerService.update((0, tenant_middleware_1.getTenantId)(req), req.params.id, req.body);
            (0, apiResponse_1.apiResponse)({ res, data: customer, message: 'Customer updated' });
        }
        catch (error) {
            next(error);
        }
    },
    async bulkDelete(req, res, next) {
        try {
            await customer_service_1.customerService.deleteAll((0, tenant_middleware_1.getTenantId)(req));
            (0, apiResponse_1.apiResponse)({ res, message: 'All customers deleted' });
        }
        catch (error) {
            next(error);
        }
    },
    async delete(req, res, next) {
        try {
            await customer_service_1.customerService.delete((0, tenant_middleware_1.getTenantId)(req), req.params.id);
            (0, apiResponse_1.apiResponse)({ res, message: 'Customer deleted' });
        }
        catch (error) {
            next(error);
        }
    },
};
//# sourceMappingURL=customer.controller.js.map