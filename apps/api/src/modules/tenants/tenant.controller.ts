// ==========================================
// Tenant Controller
// ==========================================

import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { tenantService } from './tenant.service';
import { apiResponse, apiError } from '../../utils/apiResponse';
import { z } from 'zod';

const createTenantSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  customDomain: z.string().optional().nullable(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  adminEmail: z.string().email().optional(),
  adminPassword: z.string().min(6).optional(),
});

const extendSubscriptionSchema = z.object({
  // Pozitif = uzat, negatif = azalt. 120 ay = 10 yil, mantikli bir ust sinir.
  months: z.number().int().min(-120).max(120),
});

const updateTenantSchema = z.object({
  name: z.string().min(2).optional(),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/).optional(),
  customDomain: z.string().optional().nullable(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  settings: z.any().optional(),
  isActive: z.boolean().optional(),
  logo: z.string().url().optional().or(z.literal('')),
});

export const tenantController = {
  async getAll(_req: Request, res: Response, next: NextFunction) {
    try {
      const tenants = await tenantService.findAll();
      apiResponse({ res, data: tenants });
    } catch (error) { next(error); }
  },

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      if (req.user?.role !== 'SUPER_ADMIN' && req.user?.tenantId !== id) {
        apiError(res, 403, 'Başka bir işletmenin ayarlarına erişemezsiniz');
        return;
      }
      const tenant = await tenantService.findById(id);
      if (!tenant) { apiError(res, 404, 'Tenant not found'); return; }
      apiResponse({ res, data: tenant });
    } catch (error) { next(error); }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createTenantSchema.parse(req.body);
      const tenant = await tenantService.create(input as any);
      apiResponse({ res, statusCode: 201, data: tenant, message: 'Tenant created' });
    } catch (error) { next(error); }
  },

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      if (req.user?.role !== 'SUPER_ADMIN' && req.user?.tenantId !== id) {
        apiError(res, 403, 'Başka bir işletmenin ayarlarını değiştiremezsiniz');
        return;
      }
      const input = updateTenantSchema.parse(req.body) as any;
      if (req.body.settings !== undefined) {
        input.settings = req.body.settings;
      }
      const tenant = await tenantService.update(id, input);
      apiResponse({ res, data: tenant, message: 'Tenant updated' });
    } catch (error) { next(error); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await tenantService.delete(((req.params.id as string)));
      apiResponse({ res, message: 'Tenant deleted' });
    } catch (error) { next(error); }
  },

  /** Uyelik suresi uzatma/azaltma — yalnizca SUPER_ADMIN (bkz. tenant.routes.ts). */
  async extendSubscription(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { months } = extendSubscriptionSchema.parse(req.body);
      const tenant = await tenantService.extendSubscription(id, months);
      apiResponse({ res, data: tenant, message: 'Abonelik güncellendi' });
    } catch (error) { next(error); }
  },

  /** Print-agent sirrini yeniden uretir (kendi tenant'i veya SUPER_ADMIN). */
  async regeneratePrintAgentSecret(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      if (req.user?.role !== 'SUPER_ADMIN' && req.user?.tenantId !== id) {
        apiError(res, 403, 'Başka bir işletmenin yazıcı anahtarını değiştiremezsiniz');
        return;
      }
      const result = await tenantService.regeneratePrintAgentSecret(id);
      apiResponse({ res, data: result, message: 'Yazıcı anahtarı yenilendi' });
    } catch (error) { next(error); }
  },
};
