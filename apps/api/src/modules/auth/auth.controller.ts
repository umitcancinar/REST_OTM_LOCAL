// ==========================================
// Auth Controller — HTTP Request Handlers
// ==========================================

import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service';
import { loginSchema, pinLoginSchema, registerSchema, refreshTokenSchema, changePasswordSchema, adminResetPasswordSchema } from './auth.validation';
import { apiResponse, apiError } from '../../utils/apiResponse';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { getTenantId } from '../../middlewares/tenant.middleware';

/**
 * Oturum kaydina yazilacak istek baglami.
 * Kullaniciya "su cihazdan giris yapildi" bilgisini gosterebilmek ve
 * supheli bir oturumu ayirt edebilmek icin tutuluyor.
 * NOT: app.ts icinde `trust proxy` acik oldugu icin req.ip, nginx
 * arkasindayken de gercek istemci adresini verir.
 */
function sessionContext(req: Request) {
  return {
    userAgent: req.get('user-agent') ?? undefined,
    ip: req.ip,
  };
}

export const authController = {
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = loginSchema.parse(req.body);
      const result = await authService.login(input, sessionContext(req));
      apiResponse({ res, data: result, message: 'Login successful' });
    } catch (error: unknown) {
      const err = error as Error & { statusCode?: number };
      if (err.statusCode) {
        apiError(res, err.statusCode, err.message);
        return;
      }
      next(error);
    }
  },

  async pinLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = pinLoginSchema.parse(req.body);
      const result = await authService.pinLogin(input, sessionContext(req));
      apiResponse({ res, data: result, message: 'PIN login successful' });
    } catch (error: unknown) {
      const err = error as Error & { statusCode?: number };
      if (err.statusCode) {
        apiError(res, err.statusCode, err.message);
        return;
      }
      next(error);
    }
  },

  async register(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = registerSchema.parse(req.body);
      // GUVENLIK: hedef tenant istekten degil, kimlik dogrulanmis kullanicinin
      // kendi tenant'indan (SUPER_ADMIN icin tenantMiddleware'in izin verdigi
      // x-tenant-id override'iyla) belirleniyor. Bkz. auth.routes.ts.
      const tenantId = getTenantId(req);
      const result = await authService.register(input, tenantId);
      apiResponse({ res, statusCode: 201, data: result, message: 'User registered successfully' });
    } catch (error: unknown) {
      const err = error as Error & { statusCode?: number };
      if (err.statusCode) {
        apiError(res, err.statusCode, err.message);
        return;
      }
      next(error);
    }
  },

  async refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = refreshTokenSchema.parse(req.body);
      const tokens = await authService.refreshToken(refreshToken, sessionContext(req));
      apiResponse({ res, data: tokens, message: 'Token refreshed successfully' });
    } catch (error: unknown) {
      const err = error as Error & { statusCode?: number };
      if (err.statusCode) {
        apiError(res, err.statusCode, err.message);
        return;
      }
      next(error);
    }
  },

  /**
   * Cikis — refresh token'i sunucu tarafinda iptal eder.
   * Kimlik dogrulamasi ISTEMEZ: suresi dolmus bir access token'la da
   * cikilabilmeli, aksi halde kullanici oturumunu kapatamadan kalir.
   * Gecersiz token'da da 200 doner (bkz. authService.logout).
   */
  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined;
      await authService.logout(refreshToken);
      apiResponse({ res, data: { success: true }, message: 'Çıkış yapıldı' });
    } catch (error: unknown) {
      next(error);
    }
  },

  async getProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        apiError(res, 401, 'Not authenticated');
        return;
      }
      const profile = await authService.getProfile(req.user.userId);
      apiResponse({ res, data: profile });
    } catch (error: unknown) {
      const err = error as Error & { statusCode?: number };
      if (err.statusCode) {
        apiError(res, err.statusCode, err.message);
        return;
      }
      next(error);
    }
  },

  async verifyPin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { pin } = req.body;
      if (!pin) {
        apiError(res, 400, 'PIN is required');
        return;
      }
      
      const user = await authService.verifyPin(req.user!.tenantId, pin);
      apiResponse({ res, data: user, message: 'PIN verified' });
    } catch (error: unknown) {
      const err = error as Error & { statusCode?: number };
      if (err.statusCode) {
        apiError(res, err.statusCode, err.message);
        return;
      }
      next(error);
    }
  },

  async changePassword(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
      const result = await authService.changePassword(req.user!.userId, currentPassword, newPassword);
      apiResponse({ res, data: result, message: 'Password changed successfully' });
    } catch (error: unknown) {
      const err = error as Error & { statusCode?: number };
      if (err.statusCode) {
        apiError(res, err.statusCode, err.message);
        return;
      }
      next(error);
    }
  },

  async adminResetPassword(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.user!.role !== 'SUPER_ADMIN' && req.user!.role !== 'OWNER') {
        apiError(res, 403, 'Bu işlem için yetkiniz bulunmuyor.');
        return;
      }
      const { targetRole, newPassword } = adminResetPasswordSchema.parse(req.body);
      const result = await authService.adminResetPassword(req.user!.tenantId!, targetRole, newPassword);
      apiResponse({ res, data: result, message: 'Kullanıcı şifresi başarıyla değiştirildi.' });
    } catch (error: unknown) {
      const err = error as Error & { statusCode?: number };
      if (err.statusCode) {
        apiError(res, err.statusCode, err.message);
        return;
      }
      next(error);
    }
  },
};
