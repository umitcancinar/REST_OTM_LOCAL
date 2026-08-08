import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { apiResponse } from '../../utils/apiResponse';
import { licenseAdminService } from './license-admin.service';
import {
  actionReasonSchema,
  createLicenseSchema,
  extendLicenseSchema,
  licenseIdSchema,
  listLicensesSchema,
  rebindLicenseSchema,
  updateLicenseSchema,
} from './license-admin.validation';

function operatorId(req: AuthenticatedRequest): string {
  if (!req.user) throw Object.assign(new Error('Kimlik doğrulama gerekli.'), { statusCode: 401 });
  return req.user.userId;
}

export const licenseAdminController = {
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const input = listLicensesSchema.parse(req.query);
      const result = await licenseAdminService.list(input);
      apiResponse({
        res,
        data: result,
        meta: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: Math.ceil(result.total / result.limit),
        },
      });
    } catch (error) { next(error); }
  },

  async detail(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = licenseIdSchema.parse(req.params);
      apiResponse({ res, data: await licenseAdminService.detail(id) });
    } catch (error) { next(error); }
  },

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const input = createLicenseSchema.parse(req.body);
      const result = await licenseAdminService.create(input, operatorId(req));
      apiResponse({
        res,
        statusCode: 201,
        data: result,
        message: 'Lisans oluşturuldu. Anahtar tekrar gösterilmeyecek.',
      });
    } catch (error) { next(error); }
  },

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = licenseIdSchema.parse(req.params);
      const input = updateLicenseSchema.parse(req.body);
      const result = await licenseAdminService.update(id, input, operatorId(req));
      apiResponse({ res, data: result, message: 'Lisans güncellendi' });
    } catch (error) { next(error); }
  },

  async extend(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = licenseIdSchema.parse(req.params);
      const input = extendLicenseSchema.parse(req.body);
      const result = await licenseAdminService.extend(id, input, operatorId(req));
      apiResponse({ res, data: result, message: 'Lisans süresi uzatıldı' });
    } catch (error) { next(error); }
  },

  async suspend(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = licenseIdSchema.parse(req.params);
      const { reason } = actionReasonSchema.parse(req.body ?? {});
      const result = await licenseAdminService.suspend(id, reason, operatorId(req));
      apiResponse({ res, data: result, message: 'Lisans askıya alındı' });
    } catch (error) { next(error); }
  },

  async resume(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = licenseIdSchema.parse(req.params);
      const { reason } = actionReasonSchema.parse(req.body ?? {});
      const result = await licenseAdminService.resume(id, reason, operatorId(req));
      apiResponse({ res, data: result, message: 'Lisans yeniden etkinleştirildi' });
    } catch (error) { next(error); }
  },

  async revoke(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = licenseIdSchema.parse(req.params);
      const { reason } = actionReasonSchema.parse(req.body ?? {});
      const result = await licenseAdminService.revoke(id, reason, operatorId(req));
      apiResponse({ res, data: result, message: 'Lisans kalıcı olarak iptal edildi' });
    } catch (error) { next(error); }
  },

  async resetActivation(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = licenseIdSchema.parse(req.params);
      const { reason } = actionReasonSchema.parse(req.body ?? {});
      const result = await licenseAdminService.resetActivation(id, reason, operatorId(req));
      apiResponse({ res, data: result, message: 'Cihaz aktivasyonu sıfırlandı' });
    } catch (error) { next(error); }
  },

  async rebind(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = licenseIdSchema.parse(req.params);
      const input = rebindLicenseSchema.parse(req.body);
      const result = await licenseAdminService.rebind(id, input, operatorId(req));
      apiResponse({ res, data: result, message: 'Lisans yeni cihaza bağlandı' });
    } catch (error) { next(error); }
  },
};
