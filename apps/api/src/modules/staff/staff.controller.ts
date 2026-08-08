// ==========================================
// Staff Controller — HTTP Request Handlers
// ==========================================

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { getTenantId } from '../../middlewares/tenant.middleware';
import { staffService } from './staff.service';
import { apiResponse, apiError } from '../../utils/apiResponse';

export const staffController = {
  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const staff = await staffService.findAll(tenantId);
      apiResponse({ res, data: staff });
    } catch (error) { next(error); }
  },

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const { name, email, password, role, pin } = req.body;

      if (!name || !email || !password) {
        apiError(res, 400, 'İsim, e-posta ve şifre zorunludur.');
        return;
      }

      const member = await staffService.create(tenantId, { name, email, password, role, pin });
      apiResponse({ res, statusCode: 201, data: member, message: 'Personel oluşturuldu.' });
    } catch (error: any) {
      apiError(res, error.statusCode || 500, error.message || 'Personel oluşturulamadı.');
    }
  },

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params as { id: string };
      const { name, email, password, role, pin, isActive } = req.body;

      const member = await staffService.update(tenantId, id, { name, email, password, role, pin, isActive });
      apiResponse({ res, data: member, message: 'Personel güncellendi.' });
    } catch (error: any) {
      apiError(res, error.statusCode || 500, error.message || 'Personel güncellenemedi.');
    }
  },

  async remove(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params as { id: string };
      await staffService.remove(tenantId, id);
      apiResponse({ res, message: 'Personel silindi.' });
    } catch (error: any) {
      apiError(res, error.statusCode || 500, error.message || 'Personel silinemedi.');
    }
  },
};
