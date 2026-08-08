"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pos_controller_1 = require("./pos.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const feature_middleware_1 = require("../../middlewares/feature.middleware");
const router = (0, express_1.Router)();
/**
 * @route   POST /api/pos/start-payment
 * @desc    Initiate a POS transaction
 * @access  Private (Staff/Admin)
 */
router.post('/start-payment', auth_middleware_1.authMiddleware, tenant_middleware_1.tenantMiddleware, (0, feature_middleware_1.checkFeature)('pos'), pos_controller_1.posController.startPayment);
exports.default = router;
//# sourceMappingURL=pos.routes.js.map