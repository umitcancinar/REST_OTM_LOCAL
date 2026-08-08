"use strict";
// ==========================================
// Waiter Routes
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const waiter_controller_1 = require("./waiter.controller");
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const router = (0, express_1.Router)();
// Menu uygulaması müşteri tarafında olduğu için Auth gerekmez, sadece TenantID (Restoran) kontrolü gereklidir.
router.use(tenant_middleware_1.tenantMiddleware);
router.post('/call', waiter_controller_1.waiterController.callWaiter);
exports.default = router;
//# sourceMappingURL=waiter.routes.js.map