// ==========================================
// Reservation Controller
// ==========================================

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { getTenantId } from '../../middlewares/tenant.middleware';
import { reservationService } from './reservation.service';
import { apiResponse } from '../../utils/apiResponse';

export const reservationController = {
  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const reservations = await reservationService.getAll(getTenantId(req));
      apiResponse({ res, data: reservations });
    } catch (error) { next(error); }
  },

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const reservation = await reservationService.create(getTenantId(req), req.body);
      apiResponse({ res, statusCode: 201, data: reservation, message: 'Rezervasyon oluşturuldu' });
    } catch (error) { next(error); }
  },

  async updateStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { status } = req.body;
      const reservation = await reservationService.updateStatus(getTenantId(req), ((req.params.id as string)), status);
      apiResponse({ res, data: reservation, message: 'Rezervasyon durumu güncellendi' });
    } catch (error) { next(error); }
  },

  async bulkDelete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await reservationService.deleteAll(getTenantId(req));
      apiResponse({ res, message: 'Tüm rezervasyonlar temizlendi' });
    } catch (error) { next(error); }
  },

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await reservationService.delete(getTenantId(req), ((req.params.id as string)));
      apiResponse({ res, message: 'Rezervasyon silindi' });
    } catch (error) { next(error); }
  },
};
