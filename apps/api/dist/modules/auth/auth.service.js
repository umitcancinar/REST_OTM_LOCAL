"use strict";
// ==========================================
// Auth Service — Business Logic
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = require("crypto");
const database_1 = __importDefault(require("../../config/database"));
const env_1 = require("../../config/env");
const logger_1 = require("../../utils/logger");
/** Role → redirect path mapping */
const ROLE_REDIRECTS = {
    SUPER_ADMIN: '/super-admin',
    OWNER: '/overview',
    ADMIN: '/overview',
    CHEF: '/orders',
    CASHIER: '/orders',
    WAITER: '/tables',
};
/**
 * Refresh token'in veritabaninda saklanan karsiligi.
 * Token'in kendisi ASLA saklanmaz — sifre hash'lemeyle ayni mantik:
 * veritabani sizarsa eldeki ozetlerle oturum acilamaz.
 * Token yuksek entropili (imzali JWT) oldugu icin bcrypt'e gerek yok;
 * kaba kuvvetle tahmin edilemez, SHA-256 yeterli ve hizli.
 */
function hashToken(token) {
    return (0, crypto_1.createHash)('sha256').update(token).digest('hex');
}
/**
 * Access + refresh token uretir ve refresh token'i veritabanina kaydeder.
 *
 * Kayit sart: aksi halde token iptal edilemez. Onceki surumde token'lar
 * hicbir yerde tutulmuyordu, dolayisiyla "cikis yap" sadece tarayicidaki
 * kopyayi siliyordu; calinmis bir kopya suresi dolana kadar (7 gun)
 * gecerli kalmaya devam ediyordu.
 */
async function issueTokens(payload, context) {
    const accessToken = jsonwebtoken_1.default.sign(payload, env_1.env.JWT_ACCESS_SECRET, {
        expiresIn: env_1.env.JWT_ACCESS_EXPIRY,
    });
    // jti (rastgele token kimligi) SART: JWT'nin 'iat' alani saniye
    // hassasiyetinde oldugu icin, ayni kullanici icin ayni saniyede uretilen
    // iki refresh token birebir ayni string olur — ayni ozet, ayni satir,
    // benzersizlik kisitina takilir. Giris hemen ardindan yenileme yapildiginda
    // bu gercekten yasaniyor. jti her token'i benzersiz kilar.
    const refreshToken = jsonwebtoken_1.default.sign({ ...payload, jti: (0, crypto_1.randomBytes)(16).toString('hex') }, env_1.env.JWT_REFRESH_SECRET, { expiresIn: env_1.env.JWT_REFRESH_EXPIRY });
    // Bitis tarihini token'in kendi 'exp' alanindan aliyoruz ki DB kaydi ile
    // JWT her zaman ayni anda gecersiz olsun (sure ayari degisse bile).
    const decoded = jsonwebtoken_1.default.decode(refreshToken);
    const expiresAt = decoded?.exp
        ? new Date(decoded.exp * 1000)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await database_1.default.refreshToken.create({
        data: {
            tokenHash: hashToken(refreshToken),
            userId: payload.userId,
            tenantId: payload.tenantId ?? null,
            expiresAt,
            userAgent: context?.userAgent?.slice(0, 255) ?? null,
            ip: context?.ip ?? null,
        },
    });
    return { accessToken, refreshToken };
}
exports.authService = {
    /** Email + Password login */
    async login(input, context) {
        const { email, password, slug } = input;
        // Find user by email and optionally slug
        let user = await database_1.default.user.findFirst({
            where: {
                email: { equals: email.toLowerCase(), mode: 'insensitive' },
                isActive: true,
                ...(slug ? { tenant: { slug } } : {})
            },
            include: { tenant: { select: { id: true, name: true, slug: true, isActive: true, subscriptionExpiresAt: true } } },
        });
        // Fallback: If not found within the specific tenant, check if it's a SUPER_ADMIN attempting to login from a tenant page
        if (!user && slug) {
            user = await database_1.default.user.findFirst({
                where: {
                    email: { equals: email.toLowerCase(), mode: 'insensitive' },
                    role: 'SUPER_ADMIN',
                    isActive: true
                },
                include: { tenant: { select: { id: true, name: true, slug: true, isActive: true, subscriptionExpiresAt: true } } },
            });
        }
        if (!user) {
            throw Object.assign(new Error('E-posta veya şifre hatalı.'), { statusCode: 401 });
        }
        if (user.role !== 'SUPER_ADMIN' && user.tenant) {
            if (!user.tenant.isActive) {
                throw Object.assign(new Error('Bu restoran hesabı aktif değil.'), { statusCode: 403 });
            }
            // subscriptionExpiresAt null ise sure hic ayarlanmamis demektir —
            // kontrol devre disi kalir (mevcut musterileri kilitlememek icin
            // bilincli varsayilan, bkz. schema.prisma).
            if (user.tenant.subscriptionExpiresAt && user.tenant.subscriptionExpiresAt < new Date()) {
                throw Object.assign(new Error('Üyelik süreniz dolmuş. Lütfen yönetimle iletişime geçin.'), { statusCode: 403 });
            }
        }
        let isPasswordValid = await bcryptjs_1.default.compare(input.password, user.passwordHash);
        // PIN fallback: if they typed their PIN into the password field (PIN is hashed in DB)
        if (!isPasswordValid && user.pin) {
            try {
                const isPinValid = await bcryptjs_1.default.compare(input.password?.trim() || '', user.pin);
                if (isPinValid) {
                    isPasswordValid = true;
                }
            }
            catch (e) {
                // Ignore bcrypt compare error if it wasn't a valid hash format
            }
        }
        if (!isPasswordValid) {
            throw Object.assign(new Error('E-posta veya şifre hatalı.'), { statusCode: 401 });
        }
        // Update last login
        await database_1.default.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
        });
        // SUPER_ADMIN without a tenant: auto-assign the first active tenant
        // so they can seamlessly use all panels (admin, waiter, etc.)
        let effectiveTenantId = user.tenantId;
        let effectiveTenant = user.tenant;
        if (user.role === 'SUPER_ADMIN' && !effectiveTenantId) {
            const firstTenant = await database_1.default.tenant.findFirst({
                where: { isActive: true },
                select: { id: true, name: true, slug: true, isActive: true, subscriptionExpiresAt: true },
                orderBy: { createdAt: 'asc' },
            });
            if (firstTenant) {
                effectiveTenantId = firstTenant.id;
                effectiveTenant = firstTenant;
            }
        }
        const tokens = await issueTokens({
            userId: user.id,
            tenantId: effectiveTenantId,
            role: user.role,
        }, context);
        logger_1.logger.info(`User logged in: ${user.email} (${user.role})`);
        return {
            user: {
                id: user.id,
                tenantId: effectiveTenantId,
                email: user.email,
                name: user.name,
                role: user.role,
                tenant: effectiveTenant,
            },
            tokens,
            redirectTo: ROLE_REDIRECTS[user.role] || '/admin/overview',
        };
    },
    /** PIN-based quick login for waiters */
    async pinLogin(input, context) {
        const tenant = await database_1.default.tenant.findUnique({
            where: { slug: input.tenantSlug, isActive: true },
        });
        if (!tenant) {
            throw Object.assign(new Error('Restoran bulunamadı.'), { statusCode: 404 });
        }
        // Fetch all active waiters for this tenant and bcrypt-compare PIN
        const users = await database_1.default.user.findMany({
            where: { tenantId: tenant.id, isActive: true, pin: { not: null } },
        });
        let matchedUser = null;
        for (const u of users) {
            if (u.pin) {
                // Only allow bcrypt-hashed PINs in production
                const isMatch = u.pin.startsWith('$2')
                    ? await bcryptjs_1.default.compare(input.pin, u.pin)
                    : (env_1.env.isDev ? u.pin === input.pin : false);
                if (isMatch) {
                    matchedUser = u;
                    break;
                }
            }
        }
        const user = matchedUser;
        if (!user) {
            throw Object.assign(new Error('Geçersiz PIN kodu.'), { statusCode: 401 });
        }
        await database_1.default.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
        });
        const tokens = await issueTokens({
            userId: user.id,
            tenantId: user.tenantId,
            role: user.role,
        }, context);
        logger_1.logger.info(`PIN login: ${user.name} (${user.role}) @ ${tenant.name}`);
        return {
            user: {
                id: user.id,
                tenantId: user.tenantId,
                email: user.email,
                name: user.name,
                role: user.role,
            },
            tokens,
            redirectTo: ROLE_REDIRECTS[user.role] || '/waiter/tables',
        };
    },
    /**
     * Register a new user (only OWNER+ can create users).
     * `tenantId` MUTLAKA cagiran taraftan (auth.controller.ts, getTenantId(req)
     * ile) gelir — istekten degil. Eskiden input.tenantId (istemci govdesi)
     * kullaniliyordu; bu, herhangi bir OWNER'in baska bir tenant'a kullanici
     * eklemesine izin veriyordu.
     */
    async register(input, tenantId) {
        // Check if user already exists in this tenant
        const existingUser = await database_1.default.user.findFirst({
            where: { tenantId, email: input.email },
        });
        if (existingUser) {
            throw Object.assign(new Error('Bu e-posta adresi ile kayıtlı bir kullanıcı zaten var.'), {
                statusCode: 409,
            });
        }
        // Hash password
        const passwordHash = await bcryptjs_1.default.hash(input.password, env_1.env.BCRYPT_SALT_ROUNDS);
        // Hash PIN if provided
        const hashedPin = input.pin ? await bcryptjs_1.default.hash(input.pin, 10) : undefined;
        const user = await database_1.default.user.create({
            data: {
                tenantId,
                email: input.email,
                passwordHash,
                name: input.name,
                role: input.role,
                pin: hashedPin,
            },
        });
        logger_1.logger.info(`New user registered: ${user.email} (${user.role})`);
        return {
            id: user.id,
            tenantId: user.tenantId,
            email: user.email,
            name: user.name,
            role: user.role,
        };
    },
    /**
     * Access token'i yeniler ve refresh token'i DONDURUR (rotation).
     *
     * Her yenilemede eski refresh token iptal edilip yenisi verilir. Bunun
     * amaci calinti tespiti: saldirgan calinmis bir token'i kullanirsa, gercek
     * kullanici bir sonraki yenilemede IPTAL EDILMIS bir token sunmus olur
     * (veya tersi). Iptal edilmis bir token'in tekrar kullanilmasi normal
     * kullanimda imkansizdir; bu yuzden o an kullanicinin TUM oturumlari
     * kapatilir ve yeniden giris istenir.
     */
    async refreshToken(refreshToken, context) {
        try {
            const decoded = jsonwebtoken_1.default.verify(refreshToken, env_1.env.JWT_REFRESH_SECRET);
            // ─── Token bizim verdigimiz, hala gecerli bir token mi? ───────────
            // JWT imzasinin dogru olmasi yetmez: iptal edilmis bir token'in
            // imzasi da dogrudur. Iptal ancak bu kayit uzerinden anlasilir.
            const tokenHash = hashToken(refreshToken);
            const stored = await database_1.default.refreshToken.findUnique({ where: { tokenHash } });
            if (!stored) {
                throw Object.assign(new Error('Oturum bulunamadı. Lütfen tekrar giriş yapın.'), {
                    statusCode: 401,
                });
            }
            if (stored.revokedAt) {
                // Iptal edilmis token yeniden kullanildi — buyuk olasilikla calinti.
                // Kullanicinin acik tum oturumlarini kapat.
                const killed = await database_1.default.refreshToken.updateMany({
                    where: { userId: stored.userId, revokedAt: null },
                    data: { revokedAt: new Date() },
                });
                logger_1.logger.warn(`Iptal edilmis refresh token yeniden kullanildi (userId=${stored.userId}). ` +
                    `${killed.count} oturum guvenlik nedeniyle kapatildi.`);
                throw Object.assign(new Error('Oturum güvenlik nedeniyle sonlandırıldı. Lütfen tekrar giriş yapın.'), { statusCode: 401 });
            }
            if (stored.expiresAt < new Date()) {
                throw Object.assign(new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.'), {
                    statusCode: 401,
                });
            }
            // Verify user still exists and is active
            // GUVENLIK: eskiden sadece User.isActive kontrol ediliyordu — bir
            // restoran pasife alinsa (veya uyeligi dolsa) bile zaten girisi
            // acik kullanicilar token yenileyerek sinirsiz erisebiliyordu.
            // Artik login()'deki ile ayni tenant kontrolu burada da yapiliyor.
            const user = await database_1.default.user.findFirst({
                where: { id: decoded.userId, isActive: true },
                include: { tenant: { select: { isActive: true, subscriptionExpiresAt: true } } },
            });
            if (!user) {
                throw Object.assign(new Error('Kullanıcı bulunamadı veya pasif.'), { statusCode: 401 });
            }
            if (user.role !== 'SUPER_ADMIN' && user.tenant) {
                if (!user.tenant.isActive) {
                    throw Object.assign(new Error('Bu restoran hesabı aktif değil.'), { statusCode: 403 });
                }
                if (user.tenant.subscriptionExpiresAt && user.tenant.subscriptionExpiresAt < new Date()) {
                    throw Object.assign(new Error('Üyelik süreniz dolmuş. Lütfen yönetimle iletişime geçin.'), { statusCode: 403 });
                }
            }
            const tokens = await issueTokens({
                userId: user.id,
                tenantId: user.tenantId,
                role: user.role,
            }, context);
            // Rotasyon: eski token bu andan itibaren gecersiz. replacedBy alani
            // zinciri kaydeder — bir calinti tespitinde hangi token'dan turedigi
            // izlenebilsin diye.
            await database_1.default.refreshToken.update({
                where: { id: stored.id },
                data: { revokedAt: new Date(), replacedBy: hashToken(tokens.refreshToken) },
            });
            return tokens;
        }
        catch (error) {
            if (error instanceof jsonwebtoken_1.default.TokenExpiredError) {
                throw Object.assign(new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.'), {
                    statusCode: 401,
                });
            }
            // Yukarida bilerek firlatilan hatalari (kullanici pasif, tenant pasif,
            // uyelik dolmus — kendi statusCode + mesajlarina sahip) oldugu gibi
            // gecir; yalnizca gercek bir JWT dogrulama hatasinda genel mesaja dus.
            if (error && typeof error === 'object' && 'statusCode' in error) {
                throw error;
            }
            throw Object.assign(new Error('Geçersiz oturum.'), { statusCode: 401 });
        }
    },
    /**
     * Cikis: refresh token'i gercekten iptal eder.
     *
     * Onceki surumde cikis diye bir islem yoktu; istemci token'i siliyordu
     * ama sunucu tarafinda hicbir sey degismiyordu. Ortak kullanilan bir
     * garson tabletinde bu, "cikis yapildi" gorunse de oturumun acik
     * kalmasi demekti.
     *
     * Gecersiz veya bilinmeyen token'da da sessizce basarili doner: cikis
     * islemi, saldirganin token gecerliligini sinamasina yarayan bir arac
     * olmamali.
     */
    async logout(refreshToken) {
        if (!refreshToken)
            return { success: true };
        const result = await database_1.default.refreshToken.updateMany({
            where: { tokenHash: hashToken(refreshToken), revokedAt: null },
            data: { revokedAt: new Date() },
        });
        if (result.count > 0)
            logger_1.logger.info('Oturum kapatildi (refresh token iptal edildi).');
        return { success: true };
    },
    /**
     * Bir kullanicinin TUM oturumlarini kapatir.
     * Sifre degisikligi ve "diger cihazlardan cikis" icin kullanilir.
     */
    async revokeAllForUser(userId) {
        const result = await database_1.default.refreshToken.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        logger_1.logger.info(`Kullanici ${userId} icin ${result.count} oturum iptal edildi.`);
        return result.count;
    },
    /**
     * Bir restoranin TUM oturumlarini kapatir.
     *
     * Superadmin bir tenant'i pasife aldiginda veya uyeligi bittiginde
     * kullanilir. Bu olmadan, o an acik olan access token'lar suresi
     * dolana kadar (15 dk) calismaya devam ederdi.
     */
    async revokeAllForTenant(tenantId) {
        const result = await database_1.default.refreshToken.updateMany({
            where: { tenantId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        logger_1.logger.info(`Tenant ${tenantId} icin ${result.count} oturum iptal edildi.`);
        return result.count;
    },
    /**
     * Suresi dolmus token kayitlarini siler.
     * Tablo suresiz buyumesin diye periyodik olarak cagrilir.
     */
    async cleanupExpiredTokens() {
        const result = await database_1.default.refreshToken.deleteMany({
            where: { expiresAt: { lt: new Date() } },
        });
        if (result.count > 0)
            logger_1.logger.info(`${result.count} suresi dolmus token kaydi temizlendi.`);
        return result.count;
    },
    /** Get current user profile */
    async getProfile(userId) {
        const user = await database_1.default.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                tenantId: true,
                email: true,
                name: true,
                role: true,
                lastLoginAt: true,
                createdAt: true,
                tenant: {
                    select: { id: true, name: true, slug: true, settings: true },
                },
            },
        });
        if (!user) {
            throw Object.assign(new Error('Kullanıcı bulunamadı.'), { statusCode: 404 });
        }
        return user;
    },
    /** Verify PIN without logging in (for authorization of specific actions) */
    async verifyPin(tenantId, pin) {
        // Fetch all users with PINs for this tenant
        const users = await database_1.default.user.findMany({
            where: { tenantId, isActive: true, pin: { not: null } },
            select: { id: true, name: true, role: true, tenantId: true, pin: true }
        });
        let matchedUser = null;
        for (const u of users) {
            if (u.pin) {
                // Only allow bcrypt-hashed PINs in production
                const isMatch = u.pin.startsWith('$2')
                    ? await bcryptjs_1.default.compare(pin, u.pin)
                    : (env_1.env.isDev ? u.pin === pin : false);
                if (isMatch) {
                    matchedUser = u;
                    break;
                }
            }
        }
        if (!matchedUser) {
            throw Object.assign(new Error('Geçersiz PIN kodu.'), { statusCode: 401 });
        }
        // Strip the pin hash before returning
        const { pin: _pin, ...safeUser } = matchedUser;
        return safeUser;
    },
    /** Change user password */
    async changePassword(userId, currentPassword, newPassword) {
        const user = await database_1.default.user.findUnique({
            where: { id: userId },
        });
        if (!user) {
            throw Object.assign(new Error('Kullanıcı bulunamadı.'), { statusCode: 404 });
        }
        const isPasswordValid = await bcryptjs_1.default.compare(currentPassword, user.passwordHash);
        if (!isPasswordValid) {
            throw Object.assign(new Error('Mevcut şifre hatalı.'), { statusCode: 400 });
        }
        const passwordHash = await bcryptjs_1.default.hash(newPassword, env_1.env.BCRYPT_SALT_ROUNDS);
        await database_1.default.user.update({
            where: { id: userId },
            data: { passwordHash },
        });
        // Sifre degistiginde tum oturumlar kapanir. Sifre degistirmenin en yaygin
        // sebebi "hesabima birisi girmis olabilir" suphesidir; eski oturumlar
        // acik kalirsa sifre degistirmek o kisiyi disari atmaz.
        await this.revokeAllForUser(userId);
        logger_1.logger.info(`User changed password: ${user.email} (tum oturumlar kapatildi)`);
        return { success: true };
    },
    /** Admin or Owner changes another role's password */
    async adminResetPassword(tenantId, targetRole, newPassword) {
        const targetUsers = await database_1.default.user.findMany({
            where: { tenantId, role: targetRole }
        });
        if (targetUsers.length === 0) {
            throw Object.assign(new Error(`Belirtilen rolde (${targetRole}) kullanıcı bulunamadı.`), { statusCode: 404 });
        }
        const passwordHash = await bcryptjs_1.default.hash(newPassword, env_1.env.BCRYPT_SALT_ROUNDS);
        // Update all users with that role in the tenant
        await database_1.default.user.updateMany({
            where: { tenantId, role: targetRole },
            data: { passwordHash }
        });
        logger_1.logger.info(`Admin reset password for role: ${targetRole} in tenant: ${tenantId}`);
        return { success: true, updatedCount: targetUsers.length };
    },
};
//# sourceMappingURL=auth.service.js.map