"use strict";
// ==========================================
// Staff Controller — HTTP Request Handlers
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffController = void 0;
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const staff_service_1 = require("./staff.service");
const apiResponse_1 = require("../../utils/apiResponse");
exports.staffController = {
    async getAll(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const staff = await staff_service_1.staffService.findAll(tenantId);
            (0, apiResponse_1.apiResponse)({ res, data: staff });
        }
        catch (error) {
            next(error);
        }
    },
    async create(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const { name, email, password, role, pin } = req.body;
            if (!name || !email || !password) {
                (0, apiResponse_1.apiError)(res, 400, 'İsim, e-posta ve şifre zorunludur.');
                return;
            }
            const member = await staff_service_1.staffService.create(tenantId, { name, email, password, role, pin });
            (0, apiResponse_1.apiResponse)({ res, statusCode: 201, data: member, message: 'Personel oluşturuldu.' });
        }
        catch (error) {
            (0, apiResponse_1.apiError)(res, error.statusCode || 500, error.message || 'Personel oluşturulamadı.');
        }
    },
    async update(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const { id } = req.params;
            const { name, email, password, role, pin, isActive } = req.body;
            const member = await staff_service_1.staffService.update(tenantId, id, { name, email, password, role, pin, isActive });
            (0, apiResponse_1.apiResponse)({ res, data: member, message: 'Personel güncellendi.' });
        }
        catch (error) {
            (0, apiResponse_1.apiError)(res, error.statusCode || 500, error.message || 'Personel güncellenemedi.');
        }
    },
    async remove(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const { id } = req.params;
            await staff_service_1.staffService.remove(tenantId, id);
            (0, apiResponse_1.apiResponse)({ res, message: 'Personel silindi.' });
        }
        catch (error) {
            (0, apiResponse_1.apiError)(res, error.statusCode || 500, error.message || 'Personel silinemedi.');
        }
    },
};
//# sourceMappingURL=staff.controller.js.map