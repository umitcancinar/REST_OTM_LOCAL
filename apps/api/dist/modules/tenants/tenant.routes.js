"use strict";
// ==========================================
// Tenant Routes
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const tenant_controller_1 = require("./tenant.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
router.use(tenant_middleware_1.tenantMiddleware);
// Super Admins only for global actions
router.get('/', (0, rbac_middleware_1.rbac)('SUPER_ADMIN'), tenant_controller_1.tenantController.getAll);
router.post('/', (0, rbac_middleware_1.rbac)('SUPER_ADMIN'), tenant_controller_1.tenantController.create);
router.delete('/:id', (0, rbac_middleware_1.rbac)('SUPER_ADMIN'), tenant_controller_1.tenantController.delete);
// Uyelik suresi: yalniz SUPER_ADMIN — OWNER/ADMIN kendi suresini uzatamaz.
router.patch('/:id/subscription', (0, rbac_middleware_1.rbac)('SUPER_ADMIN'), tenant_controller_1.tenantController.extendSubscription);
// Owners and Super Admins can manage a single tenant
router.get('/:id', (0, rbac_middleware_1.rbac)('SUPER_ADMIN', 'OWNER', 'ADMIN'), tenant_controller_1.tenantController.getById);
router.patch('/:id', (0, rbac_middleware_1.rbac)('SUPER_ADMIN', 'OWNER', 'ADMIN'), tenant_controller_1.tenantController.update);
// Sir HER ZAMAN sunucuda uretilir — kasitli olarak update()'ten ayri bir uc
// nokta (updateTenantSchema printAgentSecret'i hic kabul etmiyor).
router.post('/:id/regenerate-print-secret', (0, rbac_middleware_1.rbac)('SUPER_ADMIN', 'OWNER', 'ADMIN'), tenant_controller_1.tenantController.regeneratePrintAgentSecret);
exports.default = router;
//# sourceMappingURL=tenant.routes.js.map