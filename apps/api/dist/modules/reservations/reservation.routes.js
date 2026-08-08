"use strict";
// ==========================================
// Reservation Routes
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const reservation_controller_1 = require("./reservation.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const feature_middleware_1 = require("../../middlewares/feature.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
router.use(tenant_middleware_1.tenantMiddleware);
router.use((0, feature_middleware_1.checkFeature)('reservations'));
router.get('/', reservation_controller_1.reservationController.getAll);
router.post('/', reservation_controller_1.reservationController.create);
router.patch('/:id/status', reservation_controller_1.reservationController.updateStatus);
router.delete('/', (0, rbac_middleware_1.minRole)('OWNER'), reservation_controller_1.reservationController.bulkDelete);
router.delete('/:id', (0, rbac_middleware_1.minRole)('CASHIER'), reservation_controller_1.reservationController.delete);
exports.default = router;
//# sourceMappingURL=reservation.routes.js.map