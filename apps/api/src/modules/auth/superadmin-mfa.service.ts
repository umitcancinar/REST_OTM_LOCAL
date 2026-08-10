import bcrypt from 'bcryptjs';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { cloudEnv } from '../../config/env.cloud';
import { issueTokens, type SessionContext } from './auth.service';

const MFA_TTL_MS = 10 * 60 * 1000;
const START_WINDOW_MS = 15 * 60 * 1000;
const MAX_STARTS_PER_WINDOW = 5;
const MAX_ATTEMPTS = 5;

type StartInput = { email: string; password: string };

function fail(message: string, statusCode: number): never {
  throw Object.assign(new Error(message), { statusCode });
}

function codeHash(challengeId: string, code: string): string {
  return createHmac('sha256', cloudEnv.SUPERADMIN_MFA_PEPPER)
    .update(`${challengeId}:${code}`, 'utf8')
    .digest('hex');
}

function equalHex(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function emailHint(email: string): string {
  return email.replace(/^(.{2}).*(@.*)$/, '$1••••$2');
}

export const superAdminMfaService = {
  /**
   * Parolayi dogrular fakat token URETMEZ. Challenge PostgreSQL'e yazilir;
   * plaintext kod yalnizca bir kez, Resend'e iletmesi icin guvenilir BFF'e
   * doner. Kullanici basina DB tabanli pencere limiti ortak Render IP'lerinin
   * birbirini kilitlemesini engeller.
   */
  async start(input: StartInput, context?: SessionContext) {
    const email = input.email.trim().toLowerCase();
    const user = await prisma.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        role: 'SUPER_ADMIN',
        isActive: true,
      },
      select: { id: true, email: true, passwordHash: true },
    });
    if (!user || !await bcrypt.compare(input.password, user.passwordHash)) {
      fail('E-posta veya şifre hatalı.', 401);
    }

    const id = randomBytes(24).toString('base64url');
    const code = String(randomInt(100000, 1_000_000));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + MFA_TTL_MS);
    const startWindow = new Date(now.getTime() - START_WINDOW_MS);

    try {
      await prisma.$transaction(async (tx) => {
        const recentStarts = await tx.superAdminMfaChallenge.count({
          where: { userId: user.id, createdAt: { gte: startWindow } },
        });
        if (recentStarts >= MAX_STARTS_PER_WINDOW) {
          fail('Çok fazla doğrulama kodu istendi. Bir süre sonra tekrar deneyin.', 429);
        }

        // Yeni kod onceki tum acik kodlari gecersiz kilar. Partial unique DB
        // index'i ve Serializable transaction eszamanli iki aktif satiri onler.
        await tx.superAdminMfaChallenge.updateMany({
          where: { userId: user.id, consumedAt: null, invalidatedAt: null },
          data: { invalidatedAt: now },
        });
        await tx.superAdminMfaChallenge.create({
          data: {
            id,
            userId: user.id,
            codeHash: codeHash(id, code),
            maxAttempts: MAX_ATTEMPTS,
            expiresAt,
            requestedIp: context?.ip?.slice(0, 64) || null,
            userAgent: context?.userAgent?.slice(0, 512) || null,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      // Serializable conflict/partial unique race istemciye ayrinti sizdirmaz.
      if (error instanceof Error && 'statusCode' in error) throw error;
      fail('Doğrulama isteği başlatılamadı. Lütfen tekrar deneyin.', 409);
    }

    return { challengeId: id, code, expiresAt: expiresAt.toISOString(), email: user.email, emailHint: emailHint(user.email) };
  },

  /**
   * Dogru kodu atomik update ile tek kullanimlik olarak tuketir. Token kaydi
   * ayni transaction'da uretilir; token uretimi basarisizsa consumedAt de
   * commit olmaz. Paralel replay isteklerinden yalniz biri update count=1 alir.
   */
  async verify(challengeId: string, code: string, context?: SessionContext) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(challengeId) || !/^\d{6}$/.test(code)) {
      fail('Doğrulama kodu geçersiz.', 401);
    }

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const challenge = await tx.superAdminMfaChallenge.findUnique({
        where: { id: challengeId },
        include: {
          user: {
            select: {
              id: true,
              tenantId: true,
              email: true,
              name: true,
              role: true,
              isActive: true,
              tenant: { select: { id: true, name: true, slug: true, isActive: true, subscriptionExpiresAt: true } },
            },
          },
        },
      });

        if (
          !challenge
          || challenge.consumedAt
          || challenge.invalidatedAt
          || challenge.expiresAt <= now
          || challenge.attempts >= challenge.maxAttempts
          || !challenge.user.isActive
          || challenge.user.role !== 'SUPER_ADMIN'
        ) return { ok: false as const, statusCode: 401, message: 'Doğrulama oturumu sona erdi. Yeniden giriş yapın.' };

        const correct = equalHex(codeHash(challenge.id, code), challenge.codeHash);
        if (!correct) {
          const nextAttempts = challenge.attempts + 1;
          const changed = await tx.superAdminMfaChallenge.updateMany({
          where: {
            id: challenge.id,
            attempts: challenge.attempts,
            consumedAt: null,
            invalidatedAt: null,
            expiresAt: { gt: now },
          },
          data: {
            attempts: { increment: 1 },
            ...(nextAttempts >= challenge.maxAttempts ? { invalidatedAt: now } : {}),
          },
        });
          if (changed.count !== 1) return { ok: false as const, statusCode: 409, message: 'Doğrulama oturumu değişti. Yeniden deneyin.' };
          const remaining = Math.max(0, challenge.maxAttempts - nextAttempts);
          return { ok: false as const, statusCode: 401, message: remaining > 0 ? `Kod doğru değil. ${remaining} deneme hakkınız kaldı.` : 'Çok fazla hatalı deneme yapıldı. Yeniden giriş yapın.' };
        }

        const consumed = await tx.superAdminMfaChallenge.updateMany({
        where: {
          id: challenge.id,
          attempts: challenge.attempts,
          consumedAt: null,
          invalidatedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
        if (consumed.count !== 1) return { ok: false as const, statusCode: 409, message: 'Kod daha önce kullanılmış. Yeniden giriş yapın.' };

        const tokens = await issueTokens(
          { userId: challenge.user.id, tenantId: challenge.user.tenantId, role: challenge.user.role },
          context,
          tx,
        );
        await tx.user.update({ where: { id: challenge.user.id }, data: { lastLoginAt: now } });

        return {
          ok: true as const,
          value: {
            user: {
              id: challenge.user.id,
              tenantId: challenge.user.tenantId,
              email: challenge.user.email,
              name: challenge.user.name,
              role: challenge.user.role,
              tenant: challenge.user.tenant,
            },
            tokens,
          },
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (!outcome.ok) fail(outcome.message, outcome.statusCode);
      return outcome.value;
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        fail('Doğrulama isteği eşzamanlı olarak işlendi. Yeniden giriş yapın.', 409);
      }
      throw error;
    }
  },
};
