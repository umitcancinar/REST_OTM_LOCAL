"use strict";
// ==========================================
// Tenant Controller
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantController = void 0;
const tenant_service_1 = require("./tenant.service");
const apiResponse_1 = require("../../utils/apiResponse");
const zod_1 = require("zod");
const createTenantSchema = zod_1.z.object({
    name: zod_1.z.string().min(2),
    slug: zod_1.z.string().min(2).regex(/^[a-z0-9-]+$/),
    customDomain: zod_1.z.string().optional().nullable(),
    address: zod_1.z.string().optional(),
    phone: zod_1.z.string().optional(),
    email: zod_1.z.string().email().optional(),
    adminEmail: zod_1.z.string().email().optional(),
    adminPassword: zod_1.z.string().min(6).optional(),
});
const extendSubscriptionSchema = zod_1.z.object({
    // Pozitif = uzat, negatif = azalt. 120 ay = 10 yil, mantikli bir ust sinir.
    months: zod_1.z.number().int().min(-120).max(120),
});
const updateTenantSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).optional(),
    slug: zod_1.z.string().min(2).regex(/^[a-z0-9-]+$/).optional(),
    customDomain: zod_1.z.string().optional().nullable(),
    address: zod_1.z.string().optional(),
    phone: zod_1.z.string().optional(),
    email: zod_1.z.string().email().optional(),
    settings: zod_1.z.any().optional(),
    isActive: zod_1.z.boolean().optional(),
    logo: zod_1.z.string().url().optional().or(zod_1.z.literal('')),
});
exports.tenantController = {
    async getAll(_req, res, next) {
        try {
            const tenants = await tenant_service_1.tenantService.findAll();
            (0, apiResponse_1.apiResponse)({ res, data: tenants });
        }
        catch (error) {
            next(error);
        }
    },
    async getById(req, res, next) {
        try {
            const id = req.params.id;
            if (req.user?.role !== 'SUPER_ADMIN' && req.user?.tenantId !== id) {
                (0, apiResponse_1.apiError)(res, 403, 'Başka bir işletmenin ayarlarına erişemezsiniz');
                return;
            }
            const tenant = await tenant_service_1.tenantService.findById(id);
            if (!tenant) {
                (0, apiResponse_1.apiError)(res, 404, 'Tenant not found');
                return;
            }
            (0, apiResponse_1.apiResponse)({ res, data: tenant });
        }
        catch (error) {
            next(error);
        }
    },
    async create(req, res, next) {
        try {
            const input = createTenantSchema.parse(req.body);
            const tenant = await tenant_service_1.tenantService.create(input);
            (0, apiResponse_1.apiResponse)({ res, statusCode: 201, data: tenant, message: 'Tenant created' });
        }
        catch (error) {
            next(error);
        }
    },
    async update(req, res, next) {
        try {
            const id = req.params.id;
            if (req.user?.role !== 'SUPER_ADMIN' && req.user?.tenantId !== id) {
                (0, apiResponse_1.apiError)(res, 403, 'Başka bir işletmenin ayarlarını değiştiremezsiniz');
                return;
            }
            const input = updateTenantSchema.parse(req.body);
            if (req.body.settings !== undefined) {
                input.settings = req.body.settings;
            }
            const tenant = await tenant_service_1.tenantService.update(id, input);
            (0, apiResponse_1.apiResponse)({ res, data: tenant, message: 'Tenant updated' });
        }
        catch (error) {
            next(error);
        }
    },
    async delete(req, res, next) {
        try {
            await tenant_service_1.tenantService.delete(req.params.id);
            (0, apiResponse_1.apiResponse)({ res, message: 'Tenant deleted' });
        }
        catch (error) {
            next(error);
        }
    },
    /** Uyelik suresi uzatma/azaltma — yalnizca SUPER_ADMIN (bkz. tenant.routes.ts). */
    async extendSubscription(req, res, next) {
        try {
            const id = req.params.id;
            const { months } = extendSubscriptionSchema.parse(req.body);
            const tenant = await tenant_service_1.tenantService.extendSubscription(id, months);
            (0, apiResponse_1.apiResponse)({ res, data: tenant, message: 'Abonelik güncellendi' });
        }
        catch (error) {
            next(error);
        }
    },
    /** Print-agent sirrini yeniden uretir (kendi tenant'i veya SUPER_ADMIN). */
    async regeneratePrintAgentSecret(req, res, next) {
        try {
            const id = req.params.id;
            if (req.user?.role !== 'SUPER_ADMIN' && req.user?.tenantId !== id) {
                (0, apiResponse_1.apiError)(res, 403, 'Başka bir işletmenin yazıcı anahtarını değiştiremezsiniz');
                return;
            }
            const result = await tenant_service_1.tenantService.regeneratePrintAgentSecret(id);
            (0, apiResponse_1.apiResponse)({ res, data: result, message: 'Yazıcı anahtarı yenilendi' });
        }
        catch (error) {
            next(error);
        }
    },
};
//# sourceMappingURL=tenant.controller.js.map