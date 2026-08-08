"use strict";
// ==========================================
// Auth Controller — HTTP Request Handlers
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.authController = void 0;
const auth_service_1 = require("./auth.service");
const auth_validation_1 = require("./auth.validation");
const apiResponse_1 = require("../../utils/apiResponse");
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
/**
 * Oturum kaydina yazilacak istek baglami.
 * Kullaniciya "su cihazdan giris yapildi" bilgisini gosterebilmek ve
 * supheli bir oturumu ayirt edebilmek icin tutuluyor.
 * NOT: app.ts icinde `trust proxy` acik oldugu icin req.ip, nginx
 * arkasindayken de gercek istemci adresini verir.
 */
function sessionContext(req) {
    return {
        userAgent: req.get('user-agent') ?? undefined,
        ip: req.ip,
    };
}
exports.authController = {
    async login(req, res, next) {
        try {
            const input = auth_validation_1.loginSchema.parse(req.body);
            const result = await auth_service_1.authService.login(input, sessionContext(req));
            (0, apiResponse_1.apiResponse)({ res, data: result, message: 'Login successful' });
        }
        catch (error) {
            const err = error;
            if (err.statusCode) {
                (0, apiResponse_1.apiError)(res, err.statusCode, err.message);
                return;
            }
            next(error);
        }
    },
    async pinLogin(req, res, next) {
        try {
            const input = auth_validation_1.pinLoginSchema.parse(req.body);
            const result = await auth_service_1.authService.pinLogin(input, sessionContext(req));
            (0, apiResponse_1.apiResponse)({ res, data: result, message: 'PIN login successful' });
        }
        catch (error) {
            const err = error;
            if (err.statusCode) {
                (0, apiResponse_1.apiError)(res, err.statusCode, err.message);
                return;
            }
            next(error);
        }
    },
    async register(req, res, next) {
        try {
            const input = auth_validation_1.registerSchema.parse(req.body);
            // GUVENLIK: hedef tenant istekten degil, kimlik dogrulanmis kullanicinin
            // kendi tenant'indan (SUPER_ADMIN icin tenantMiddleware'in izin verdigi
            // x-tenant-id override'iyla) belirleniyor. Bkz. auth.routes.ts.
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const result = await auth_service_1.authService.register(input, tenantId);
            (0, apiResponse_1.apiResponse)({ res, statusCode: 201, data: result, message: 'User registered successfully' });
        }
        catch (error) {
            const err = error;
            if (err.statusCode) {
                (0, apiResponse_1.apiError)(res, err.statusCode, err.message);
                return;
            }
            next(error);
        }
    },
    async refreshToken(req, res, next) {
        try {
            const { refreshToken } = auth_validation_1.refreshTokenSchema.parse(req.body);
            const tokens = await auth_service_1.authService.refreshToken(refreshToken, sessionContext(req));
            (0, apiResponse_1.apiResponse)({ res, data: tokens, message: 'Token refreshed successfully' });
        }
        catch (error) {
            const err = error;
            if (err.statusCode) {
                (0, apiResponse_1.apiError)(res, err.statusCode, err.message);
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
    async logout(req, res, next) {
        try {
            const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined;
            await auth_service_1.authService.logout(refreshToken);
            (0, apiResponse_1.apiResponse)({ res, data: { success: true }, message: 'Çıkış yapıldı' });
        }
        catch (error) {
            next(error);
        }
    },
    async getProfile(req, res, next) {
        try {
            if (!req.user) {
                (0, apiResponse_1.apiError)(res, 401, 'Not authenticated');
                return;
            }
            const profile = await auth_service_1.authService.getProfile(req.user.userId);
            (0, apiResponse_1.apiResponse)({ res, data: profile });
        }
        catch (error) {
            const err = error;
            if (err.statusCode) {
                (0, apiResponse_1.apiError)(res, err.statusCode, err.message);
                return;
            }
            next(error);
        }
    },
    async verifyPin(req, res, next) {
        try {
            const { pin } = req.body;
            if (!pin) {
                (0, apiResponse_1.apiError)(res, 400, 'PIN is required');
                return;
            }
            const user = await auth_service_1.authService.verifyPin(req.user.tenantId, pin);
            (0, apiResponse_1.apiResponse)({ res, data: user, message: 'PIN verified' });
        }
        catch (error) {
            const err = error;
            if (err.statusCode) {
                (0, apiResponse_1.apiError)(res, err.statusCode, err.message);
                return;
            }
            next(error);
        }
    },
    async changePassword(req, res, next) {
        try {
            const { currentPassword, newPassword } = auth_validation_1.changePasswordSchema.parse(req.body);
            const result = await auth_service_1.authService.changePassword(req.user.userId, currentPassword, newPassword);
            (0, apiResponse_1.apiResponse)({ res, data: result, message: 'Password changed successfully' });
        }
        catch (error) {
            const err = error;
            if (err.statusCode) {
                (0, apiResponse_1.apiError)(res, err.statusCode, err.message);
                return;
            }
            next(error);
        }
    },
    async adminResetPassword(req, res, next) {
        try {
            if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'OWNER') {
                (0, apiResponse_1.apiError)(res, 403, 'Bu işlem için yetkiniz bulunmuyor.');
                return;
            }
            const { targetRole, newPassword } = auth_validation_1.adminResetPasswordSchema.parse(req.body);
            const result = await auth_service_1.authService.adminResetPassword(req.user.tenantId, targetRole, newPassword);
            (0, apiResponse_1.apiResponse)({ res, data: result, message: 'Kullanıcı şifresi başarıyla değiştirildi.' });
        }
        catch (error) {
            const err = error;
            if (err.statusCode) {
                (0, apiResponse_1.apiError)(res, err.statusCode, err.message);
                return;
            }
            next(error);
        }
    },
};
//# sourceMappingURL=auth.controller.js.map