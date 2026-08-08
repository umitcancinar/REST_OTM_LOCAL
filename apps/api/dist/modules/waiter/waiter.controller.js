"use strict";
// ==========================================
// Waiter Controller
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.waiterController = void 0;
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const apiResponse_1 = require("../../utils/apiResponse");
const socket_server_1 = require("../../websocket/socket.server");
exports.waiterController = {
    async callWaiter(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const { tableId } = req.body;
            if (!tableId) {
                (0, apiResponse_1.apiError)(res, 400, 'Masa numarası gereklidir.');
                return;
            }
            // 1. Socket.io üzerinden Garson çağırma sinyalini Tenant odasına gönder (Garson ve Admin paneline)
            (0, socket_server_1.getIO)().to(`tenant:${tenantId}`).emit('waiter:called', {
                tableId,
                time: new Date().toISOString()
            });
            // 2. Basit log veya veritabanına kayıt işlemi eklenebilir, şimdilik sadece signal yayınlıyoruz.
            (0, apiResponse_1.apiResponse)({ res, message: 'Garson başarıyla çağrıldı' });
        }
        catch (error) {
            next(error);
        }
    }
};
//# sourceMappingURL=waiter.controller.js.map