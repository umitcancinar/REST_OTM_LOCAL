"use strict";
// ==========================================
// Report Routes
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const report_controller_1 = require("./report.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
router.use(tenant_middleware_1.tenantMiddleware);
router.use((0, rbac_middleware_1.minRole)('CASHIER')); // Reports accessible to CASHIER and above
router.get('/daily', report_controller_1.reportController.getDailySummary);
router.get('/revenue', report_controller_1.reportController.getRevenueByRange);
router.get('/departments', report_controller_1.reportController.getDepartmentStats);
exports.default = router;
//# sourceMappingURL=report.routes.js.map