"use strict";
// ==========================================
// Staff Routes
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const staff_controller_1 = require("./staff.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
router.use(tenant_middleware_1.tenantMiddleware);
router.get('/', staff_controller_1.staffController.getAll);
router.post('/', (0, rbac_middleware_1.minRole)('ADMIN'), staff_controller_1.staffController.create);
router.patch('/:id', (0, rbac_middleware_1.minRole)('ADMIN'), staff_controller_1.staffController.update);
router.delete('/:id', (0, rbac_middleware_1.minRole)('ADMIN'), staff_controller_1.staffController.remove);
exports.default = router;
//# sourceMappingURL=staff.routes.js.map