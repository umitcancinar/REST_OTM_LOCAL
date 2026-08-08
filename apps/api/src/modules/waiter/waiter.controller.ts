// ==========================================
// Waiter Controller
// ==========================================

import { Response, NextFunction } from 'express';
import { getTenantId } from '../../middlewares/tenant.middleware';
import { apiResponse, apiError } from '../../utils/apiResponse';
import { getIO } from '../../websocket/socket.server';

export const waiterController = {
  async callWaiter(req: any, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const { tableId } = req.body;

      if (!tableId) {
        apiError(res, 400, 'Masa numarası gereklidir.');
        return;
      }

      // 1. Socket.io üzerinden Garson çağırma sinyalini Tenant odasına gönder (Garson ve Admin paneline)
      getIO().to(`tenant:${tenantId}`).emit('waiter:called', {
        tableId,
        time: new Date().toISOString()
      });

      // 2. Basit log veya veritabanına kayıt işlemi eklenebilir, şimdilik sadece signal yayınlıyoruz.
      apiResponse({ res, message: 'Garson başarıyla çağrıldı' });
    } catch (error) {
      next(error);
    }
  }
};
