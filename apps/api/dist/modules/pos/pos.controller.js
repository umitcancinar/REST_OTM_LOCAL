"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.posController = void 0;
const pos_service_1 = require("./pos.service");
const logger_1 = require("../../utils/logger");
exports.posController = {
    startPayment: async (req, res) => {
        try {
            const { orderId, amount } = req.body;
            const tenantId = req.tenantId;
            if (!orderId || !amount) {
                return res.status(400).json({ message: 'OrderId ve tutar (amount) gereklidir.' });
            }
            const result = await pos_service_1.posService.startPayment(tenantId, orderId, amount);
            res.status(200).json(result);
        }
        catch (error) {
            logger_1.logger.error('POS Payment Error:', error);
            res.status(500).json({ message: error.message });
        }
    }
};
//# sourceMappingURL=pos.controller.js.map