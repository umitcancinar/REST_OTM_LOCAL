// ==========================================
// Staff Controller — HTTP Request Handlers
// ==========================================

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { getTenantId } from '../../middlewares/tenant.middleware';
import { staffService } from './staff.service';
import { apiResponse, apiError } from '../../utils/apiResponse';
import { z } from 'zod';

const roleSchema = z.enum(['WAITER', 'CASHIER', 'CHEF', 'ADMIN', 'OWNER']);
const strongPassword = z.string().min(12).max(128)
  .regex(/[a-z]/, 'Şifre en az bir küçük harf içermeli.')
  .regex(/[A-Z]/, 'Şifre en az bir büyük harf içermeli.')
  .regex(/[0-9]/, 'Şifre en az bir rakam içermeli.')
  .regex(/[^A-Za-z0-9]/, 'Şifre en az bir özel karakter içermeli.');
const createStaffSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  password: strongPassword,
  role: roleSchema.default('WAITER'),
  pin: z.string().trim().regex(/^\d{4,8}$/).optional(),
}).strict();
const updateStaffSchema = createStaffSchema.partial().extend({
  pin: z.union([z.string().trim().regex(/^\d{4,8}$/), z.literal('')]).optional(),
  isActive: z.boolean().optional(),
}).strict();

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
      const { name, email, password, role, pin } = createStaffSchema.parse(req.body);

      const member = await staffService.create(tenantId, { name, email, password, role, pin });
      apiResponse({ res, statusCode: 201, data: member, message: 'Personel oluşturuldu.' });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        apiError(res, 400, error.issues[0]?.message || 'Personel bilgileri geçersiz.');
        return;
      }
      apiError(res, error.statusCode || 500, error.message || 'Personel oluşturulamadı.');
    }
  },

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const { id } = req.params as { id: string };
      const { name, email, password, role, pin, isActive } = updateStaffSchema.parse(req.body);

      const member = await staffService.update(tenantId, id, { name, email, password, role, pin, isActive });
      apiResponse({ res, data: member, message: 'Personel güncellendi.' });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        apiError(res, 400, error.issues[0]?.message || 'Personel bilgileri geçersiz.');
        return;
      }
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
