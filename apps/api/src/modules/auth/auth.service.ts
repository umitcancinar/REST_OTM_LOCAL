// ==========================================
// Auth Service — Business Logic
// ==========================================

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';
import prisma from '../../config/database';
import { sharedEnv } from '../../config/env.shared';
import { LoginInput, PinLoginInput, RegisterInput } from './auth.validation';
import { logger } from '../../utils/logger';

/** Oturum kaydina eklenen istek baglami — hangi cihazdan acildigini gosterir. */
export interface SessionContext {
  userAgent?: string;
  ip?: string;
}

/** Role → redirect path mapping */
const ROLE_REDIRECTS: Record<string, string> = {
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
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Access + refresh token uretir ve refresh token'i veritabanina kaydeder.
 *
 * Kayit sart: aksi halde token iptal edilemez. Onceki surumde token'lar
 * hicbir yerde tutulmuyordu, dolayisiyla "cikis yap" sadece tarayicidaki
 * kopyayi siliyordu; calinmis bir kopya suresi dolana kadar (7 gun)
 * gecerli kalmaya devam ediyordu.
 */
async function issueTokens(
  payload: { userId: string; tenantId?: string | null; role: string },
  context?: SessionContext,
) {
  const accessToken = jwt.sign(payload, sharedEnv.JWT_ACCESS_SECRET, {
    expiresIn: sharedEnv.JWT_ACCESS_EXPIRY as any,
  });

  // jti (rastgele token kimligi) SART: JWT'nin 'iat' alani saniye
  // hassasiyetinde oldugu icin, ayni kullanici icin ayni saniyede uretilen
  // iki refresh token birebir ayni string olur — ayni ozet, ayni satir,
  // benzersizlik kisitina takilir. Giris hemen ardindan yenileme yapildiginda
  // bu gercekten yasaniyor. jti her token'i benzersiz kilar.
  const refreshToken = jwt.sign(
    { ...payload, jti: randomBytes(16).toString('hex') },
    sharedEnv.JWT_REFRESH_SECRET,
    { expiresIn: sharedEnv.JWT_REFRESH_EXPIRY as any },
  );

  // Bitis tarihini token'in kendi 'exp' alanindan aliyoruz ki DB kaydi ile
  // JWT her zaman ayni anda gecersiz olsun (sure ayari degisse bile).
  const decoded = jwt.decode(refreshToken) as { exp?: number } | null;
  const expiresAt = decoded?.exp
    ? new Date(decoded.exp * 1000)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
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

export const authService = {
  /** Email + Password login */
  async login(input: LoginInput, context?: SessionContext) {
    const { email, password, slug } = input;
    
    // Find user by email and optionally slug
    let user = await prisma.user.findFirst({
      where: { 
        email: { equals: email.toLowerCase(), mode: 'insensitive' },
        isActive: true,
        ...(slug ? { tenant: { slug } } : {})
      },
      include: { tenant: { select: { id: true, name: true, slug: true, isActive: true, subscriptionExpiresAt: true } } },
    });

    // Fallback: If not found within the specific tenant, check if it's a SUPER_ADMIN attempting to login from a tenant page
    if (!user && slug) {
      user = await prisma.user.findFirst({
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
      // Abonelik/lisans suresinin tek karar noktasi local license gate'tir.
      // Legacy subscriptionExpiresAt burada uygulanmaz; iki farkli tarih
      // gecerli lisansi yanlislikla kilitleyemez.
    }

    let isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);

    // PIN fallback: if they typed their PIN into the password field (PIN is hashed in DB)
    if (!isPasswordValid && user.pin) {
      try {
        const isPinValid = await bcrypt.compare(input.password?.trim() || '', user.pin);
        if (isPinValid) {
          isPasswordValid = true;
        }
      } catch (e) {
        // Ignore bcrypt compare error if it wasn't a valid hash format
      }
    }

    if (!isPasswordValid) {
      throw Object.assign(new Error('E-posta veya şifre hatalı.'), { statusCode: 401 });
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // SUPER_ADMIN without a tenant: auto-assign the first active tenant
    // so they can seamlessly use all panels (admin, waiter, etc.)
    let effectiveTenantId = user.tenantId;
    let effectiveTenant = user.tenant;

    if (user.role === 'SUPER_ADMIN' && !effectiveTenantId) {
      const firstTenant = await prisma.tenant.findFirst({
        where: { isActive: true },
        select: { id: true, name: true, slug: true, isActive: true, subscriptionExpiresAt: true },
        orderBy: { createdAt: 'asc' },
      });
      if (firstTenant) {
        effectiveTenantId = firstTenant.id;
        effectiveTenant = firstTenant;
      }
    }

    const tokens = await issueTokens(
      {
        userId: user.id,
        tenantId: effectiveTenantId,
        role: user.role,
      },
      context,
    );

    logger.info(`User logged in: ${user.email} (${user.role})`);

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
  async pinLogin(input: PinLoginInput, context?: SessionContext) {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: input.tenantSlug, isActive: true },
    });

    if (!tenant) {
      throw Object.assign(new Error('Restoran bulunamadı.'), { statusCode: 404 });
    }

    // Fetch all active waiters for this tenant and bcrypt-compare PIN
    const users = await prisma.user.findMany({
      where: { tenantId: tenant.id, isActive: true, pin: { not: null } },
    });

    // Tip acikca yazilir: strictNullChecks altinda `= null` baslangici tek
    // basina `null` tipine cozulur ve sonraki atama hata verir.
    let matchedUser: (typeof users)[number] | null = null;
    for (const u of users) {
      if (u.pin) {
        // Only allow bcrypt-hashed PINs in production
        const isMatch = u.pin.startsWith('$2')
          ? await bcrypt.compare(input.pin, u.pin)
          : (sharedEnv.isDev ? u.pin === input.pin : false);
        if (isMatch) { matchedUser = u; break; }
      }
    }

    const user = matchedUser;
    if (!user) {
      throw Object.assign(new Error('Geçersiz PIN kodu.'), { statusCode: 401 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await issueTokens(
      {
        userId: user.id,
        tenantId: user.tenantId,
        role: user.role,
      },
      context,
    );

    logger.info(`PIN login: ${user.name} (${user.role}) @ ${tenant.name}`);

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
  async register(input: RegisterInput, tenantId: string) {
    // Check if user already exists in this tenant
    const existingUser = await prisma.user.findFirst({
      where: { tenantId, email: input.email },
    });

    if (existingUser) {
      throw Object.assign(new Error('Bu e-posta adresi ile kayıtlı bir kullanıcı zaten var.'), {
        statusCode: 409,
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(input.password, sharedEnv.BCRYPT_SALT_ROUNDS);

    // Hash PIN if provided
    const hashedPin = input.pin ? await bcrypt.hash(input.pin, 10) : undefined;

    const user = await prisma.user.create({
      data: {
        tenantId,
        email: input.email,
        passwordHash,
        name: input.name,
        role: input.role,
        pin: hashedPin,
      },
    });

    logger.info(`New user registered: ${user.email} (${user.role})`);

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
  async refreshToken(refreshToken: string, context?: SessionContext) {
    try {
      const decoded = jwt.verify(refreshToken, sharedEnv.JWT_REFRESH_SECRET) as {
        userId: string;
        tenantId: string;
        role: string;
      };

      // ─── Token bizim verdigimiz, hala gecerli bir token mi? ───────────
      // JWT imzasinin dogru olmasi yetmez: iptal edilmis bir token'in
      // imzasi da dogrudur. Iptal ancak bu kayit uzerinden anlasilir.
      const tokenHash = hashToken(refreshToken);
      const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

      if (!stored) {
        throw Object.assign(new Error('Oturum bulunamadı. Lütfen tekrar giriş yapın.'), {
          statusCode: 401,
        });
      }

      if (stored.revokedAt) {
        // Iptal edilmis token yeniden kullanildi — buyuk olasilikla calinti.
        // Kullanicinin acik tum oturumlarini kapat.
        const killed = await prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        logger.warn(
          `Iptal edilmis refresh token yeniden kullanildi (userId=${stored.userId}). ` +
            `${killed.count} oturum guvenlik nedeniyle kapatildi.`,
        );
        throw Object.assign(
          new Error('Oturum güvenlik nedeniyle sonlandırıldı. Lütfen tekrar giriş yapın.'),
          { statusCode: 401 },
        );
      }

      if (stored.expiresAt < new Date()) {
        throw Object.assign(new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.'), {
          statusCode: 401,
        });
      }

      // Verify user still exists and is active
      // GUVENLIK: eskiden sadece User.isActive kontrol ediliyordu — bir
      // restoran pasife alinsa bile zaten girisi
      // acik kullanicilar token yenileyerek sinirsiz erisebiliyordu.
      // Artik login()'deki ile ayni tenant kontrolu burada da yapiliyor.
      const user = await prisma.user.findFirst({
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
      }

      const tokens = await issueTokens(
        {
          userId: user.id,
          tenantId: user.tenantId,
          role: user.role,
        },
        context,
      );

      // Rotasyon: eski token bu andan itibaren gecersiz. replacedBy alani
      // zinciri kaydeder — bir calinti tespitinde hangi token'dan turedigi
      // izlenebilsin diye.
      await prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date(), replacedBy: hashToken(tokens.refreshToken) },
      });

      return tokens;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
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
  async logout(refreshToken?: string) {
    if (!refreshToken) return { success: true };

    const result = await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (result.count > 0) logger.info('Oturum kapatildi (refresh token iptal edildi).');
    return { success: true };
  },

  /**
   * Bir kullanicinin TUM oturumlarini kapatir.
   * Sifre degisikligi ve "diger cihazlardan cikis" icin kullanilir.
   */
  async revokeAllForUser(userId: string) {
    const result = await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.info(`Kullanici ${userId} icin ${result.count} oturum iptal edildi.`);
    return result.count;
  },

  /**
   * Bir restoranin TUM oturumlarini kapatir.
   *
   * Superadmin bir tenant'i pasife aldiginda veya uyeligi bittiginde
   * kullanilir. Bu olmadan, o an acik olan access token'lar suresi
   * dolana kadar (15 dk) calismaya devam ederdi.
   */
  async revokeAllForTenant(tenantId: string) {
    const result = await prisma.refreshToken.updateMany({
      where: { tenantId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.info(`Tenant ${tenantId} icin ${result.count} oturum iptal edildi.`);
    return result.count;
  },

  /**
   * Suresi dolmus token kayitlarini siler.
   * Tablo suresiz buyumesin diye periyodik olarak cagrilir.
   */
  async cleanupExpiredTokens() {
    const result = await prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) logger.info(`${result.count} suresi dolmus token kaydi temizlendi.`);
    return result.count;
  },

  /** Get current user profile */
  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
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
  async verifyPin(tenantId: string, pin: string) {
    // Fetch all users with PINs for this tenant
    const users = await prisma.user.findMany({
      where: { tenantId, isActive: true, pin: { not: null } },
      select: { id: true, name: true, role: true, tenantId: true, pin: true }
    });

    // Tip acikca yazilir: bkz. pinLogin icindeki ayni desen.
    let matchedUser: (typeof users)[number] | null = null;
    for (const u of users) {
      if (u.pin) {
        // Only allow bcrypt-hashed PINs in production
        const isMatch = u.pin.startsWith('$2')
          ? await bcrypt.compare(pin, u.pin)
          : (sharedEnv.isDev ? u.pin === pin : false);
        if (isMatch) { matchedUser = u; break; }
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
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw Object.assign(new Error('Kullanıcı bulunamadı.'), { statusCode: 404 });
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isPasswordValid) {
      throw Object.assign(new Error('Mevcut şifre hatalı.'), { statusCode: 400 });
    }

    const passwordHash = await bcrypt.hash(newPassword, sharedEnv.BCRYPT_SALT_ROUNDS);

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    // Sifre degistiginde tum oturumlar kapanir. Sifre degistirmenin en yaygin
    // sebebi "hesabima birisi girmis olabilir" suphesidir; eski oturumlar
    // acik kalirsa sifre degistirmek o kisiyi disari atmaz.
    await this.revokeAllForUser(userId);

    logger.info(`User changed password: ${user.email} (tum oturumlar kapatildi)`);
    return { success: true };
  },

  /** Admin or Owner changes another role's password */
  async adminResetPassword(tenantId: string, targetRole: any, newPassword: string) {
    const targetUsers = await prisma.user.findMany({
      where: { tenantId, role: targetRole }
    });

    if (targetUsers.length === 0) {
      throw Object.assign(new Error(`Belirtilen rolde (${targetRole}) kullanıcı bulunamadı.`), { statusCode: 404 });
    }

    const passwordHash = await bcrypt.hash(newPassword, sharedEnv.BCRYPT_SALT_ROUNDS);

    // Update all users with that role in the tenant
    await prisma.user.updateMany({
      where: { tenantId, role: targetRole },
      data: { passwordHash }
    });

    logger.info(`Admin reset password for role: ${targetRole} in tenant: ${tenantId}`);
    return { success: true, updatedCount: targetUsers.length };
  },
};
