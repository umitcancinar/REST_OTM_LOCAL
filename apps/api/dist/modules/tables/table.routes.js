"use strict";
// ==========================================
// Table Routes
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const table_controller_1 = require("./table.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
router.use(tenant_middleware_1.tenantMiddleware);
router.get('/', table_controller_1.tableController.getAll);
router.get('/:id', table_controller_1.tableController.getById);
router.post('/', (0, rbac_middleware_1.minRole)('OWNER'), table_controller_1.tableController.create);
router.patch('/:id', (0, rbac_middleware_1.minRole)('CASHIER'), table_controller_1.tableController.update);
router.delete('/:id', (0, rbac_middleware_1.minRole)('OWNER'), table_controller_1.tableController.delete);
exports.default = router;
//# sourceMappingURL=table.routes.js.map