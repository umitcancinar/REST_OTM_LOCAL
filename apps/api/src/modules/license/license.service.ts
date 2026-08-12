// ==========================================
// Lisans Servisi — BULUT tarafi
// ==========================================
// Lisansi burasi URETIR ve DENETLER. Ozel anahtar yalnizca bu surecin
// ortam degiskeninde bulunur; musteriye giden pakette yer almaz.
//
// Iki genel uc nokta var ve ikisi de kimlik dogrulamasi ISTEMEZ —
// musterinin bilgisayari henuz kimse olarak giris yapmis degil, elinde
// sadece lisans anahtari var. Kimlik dogrulamasinin yerini anahtarin
// kendisi ve donanim baglamasi tutuyor. Bu yuzden ikisi de siki sekilde
// hiz sinirlanmali (bkz. license.routes.ts).

import { issueLicense } from '@rest-otm/license/sign';
import type { LicenseEntitlement } from '@rest-otm/license';
import prisma from '../../config/database';
import { cloudEnv } from '../../config/env.cloud';
import { logger } from '../../utils/logger';
import {
  assertSignableStatus,
  isActivationEligible,
  isHeartbeatEligible,
} from './license-lifecycle.policy';
import {
  createLicenseKeyMaterial,
  licenseKeyHashCandidates,
  normalizeLicenseKey,
} from './license-key.policy';
import { issueMenuSyncToken } from '../cloud-menu-sync/cloud-menu-sync-token';

/** Yoklama araligi: lokal taraf bu siklikta baglanir. */
export const HEARTBEAT_INTERVAL_HOURS = 1;

interface ActivateInput {
  licenseKey: string;
  hardwareId: string;
  hardwareIdShort?: string;
  appVersion?: string;
  ip?: string;
}

interface HeartbeatInput {
  licenseKey: string;
  hardwareId: string;
  appVersion?: string;
  ip?: string;
}

interface CloudBackupAuthorizationInput {
  licenseKey: string;
  hardwareId: string;
}

const tenantInclude = { tenant: { select: { name: true, isActive: true } } } as const;

/**
 * Incoming raw keys are converted to all configured pepper hashes. Legacy
 * plaintext is a temporary fallback only; a successful read immediately
 * rehashes with the active pepper and clears the old column.
 */
async function findLicenseByRawKey(rawKey: string) {
  const normalizedKey = normalizeLicenseKey(rawKey);
  const candidates = licenseKeyHashCandidates(normalizedKey, cloudEnv.LICENSE_KEY_PEPPER_RING);
  let license = await prisma.license.findFirst({
    where: { keyHash: { in: candidates.map((candidate) => candidate.keyHash) } },
    include: tenantInclude,
  });

  if (!license) {
    license = await prisma.license.findUnique({
      where: { legacyKey: normalizedKey },
      include: tenantInclude,
    });
  }
  if (!license) return { license: null, normalizedKey };

  const active = createLicenseKeyMaterial(normalizedKey, cloudEnv.LICENSE_KEY_PEPPER_RING);
  if (
    license.keyHash !== active.keyHash ||
    license.keyPepperVersion !== active.keyPepperVersion ||
    license.keyLast4 !== active.keyLast4 ||
    license.legacyKey !== null
  ) {
    await prisma.license.update({
      where: { id: license.id },
      data: {
        keyHash: active.keyHash,
        keyPepperVersion: active.keyPepperVersion,
        keyLast4: active.keyLast4,
        legacyKey: null,
      },
    });
    license = {
      ...license,
      keyHash: active.keyHash,
      keyPepperVersion: active.keyPepperVersion,
      keyLast4: active.keyLast4,
      legacyKey: null,
    };
  }

  return { license, normalizedKey };
}

/** Supheli bir olayi kaydeder. Superadmin panelinde gorunur. */
async function flagSuspicious(licenseId: string, reason: string) {
  await prisma.license.update({
    where: { id: licenseId },
    data: {
      suspiciousCount: { increment: 1 },
      lastSuspiciousAt: new Date(),
    },
  });
  logger.warn(`Lisans supheli olay [${licenseId}]: ${reason}`);
}

/** Imzalanmis lisansi uretir. Sure her seferinde DB'den okunur —
 *  superadmin sureyi uzattiginda bir sonraki yoklamada otomatik yansir. */
function sign(license: {
  tenantId: string;
  expiresAt: Date;
  graceDays: number;
  features: string[];
  hardwareId: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  tenant: { name: string };
  tenantActive: boolean;
}, licenseKey: string) {
  if (!cloudEnv.LICENSE_PRIVATE_KEY) {
    throw Object.assign(new Error('Lisans sunucusu yapılandırılmamış.'), { statusCode: 503 });
  }

  // PENDING bir kaydin aktif entitlement'a dusmesi aktivasyon/reset cihaz
  // bagini baypas eder. Bu durum imzalanabilir bir lisans degildir.
  assertSignableStatus(license.status);

  return issueLicense(
    {
      licenseKey,
      tenantId: license.tenantId,
      restaurantName: license.tenant.name,
      hardwareId: license.hardwareId,
      expiresAt: license.expiresAt,
      graceDays: license.graceDays,
      features: license.features,
      entitlement: (!license.tenantActive
        ? 'tenant_disabled'
        : license.status === 'SUSPENDED'
          ? 'suspended'
          : license.status === 'REVOKED'
            ? 'revoked'
            : 'active') as LicenseEntitlement,
    },
    cloudEnv.LICENSE_PRIVATE_KEY,
  );
}

function menuSyncToken(license: {
  id: string;
  tenantId: string;
  hardwareId: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  tenant: { isActive: boolean };
}): string | null {
  if (license.status !== 'ACTIVE' || !license.tenant.isActive) return null;
  if (!cloudEnv.LICENSE_PRIVATE_KEY) {
    throw Object.assign(new Error('Lisans sunucusu yapılandırılmamış.'), { statusCode: 503 });
  }
  return issueMenuSyncToken({
    licenseId: license.id,
    tenantId: license.tenantId,
    hardwareId: license.hardwareId,
  }, cloudEnv.LICENSE_PRIVATE_KEY);
}

export const licenseService = {
  /**
   * Bulut yedegi icin kullanici oturumu yerine aktive lisans + cihaz bagi
   * kullanilir. Ham lisans anahtari hicbir zaman B2 object metadata'sina
   * veya object key'ine yazilmaz.
   */
  async authorizeCloudBackup(input: CloudBackupAuthorizationInput) {
    const { license } = await findLicenseByRawKey(input.licenseKey);
    if (!license) {
      throw Object.assign(new Error('Lisans anahtarı geçersiz.'), { statusCode: 404 });
    }
    const now = new Date();
    if (
      license.status !== 'ACTIVE'
      || !license.tenant.isActive
      || license.expiresAt < now
    ) {
      throw Object.assign(new Error('Lisans bulut yedekleme için aktif değil.'), { statusCode: 403 });
    }
    if (!license.hardwareId || license.hardwareId !== input.hardwareId) {
      await flagSuspicious(license.id, 'farkli donanimdan bulut yedekleme denemesi');
      throw Object.assign(new Error('Lisans bu cihaza tanımlı değil.'), { statusCode: 409 });
    }
    return { id: license.id, tenantId: license.tenantId };
  },

  /**
   * Aktivasyon — musterinin bilgisayarina ILK kurulumda cagrilir.
   * Lisansi o makineye baglar ve imzali lisansi dondurur.
   */
  async activate(input: ActivateInput) {
    const { license, normalizedKey } = await findLicenseByRawKey(input.licenseKey);

    // Bilinmeyen anahtar ile "baska makineye bagli" ayni mesaji dondurur:
    // saldirgan hangi anahtarlarin var oldugunu deneyerek ogrenemesin.
    if (!license) {
      throw Object.assign(new Error('Lisans anahtarı geçersiz.'), { statusCode: 404 });
    }

    if (license.status === 'REVOKED') {
      throw Object.assign(new Error('Bu lisans iptal edilmiş. Lütfen bizimle iletişime geçin.'), {
        statusCode: 403,
      });
    }
    if (license.status === 'SUSPENDED') {
      throw Object.assign(new Error('Lisansınız askıya alınmış. Lütfen bizimle iletişime geçin.'), {
        statusCode: 403,
      });
    }
    if (!license.tenant.isActive) {
      throw Object.assign(new Error('Restoran hesabı aktif değil.'), { statusCode: 403 });
    }

    // Zaten BASKA bir makineye bagliysa reddet. Ayni makineden tekrar
    // aktivasyon (yeniden kurulum) ise sorunsuz devam eder.
    if (license.hardwareId && license.hardwareId !== input.hardwareId) {
      await flagSuspicious(license.id, 'farkli donanimdan aktivasyon denemesi');
      throw Object.assign(
        new Error('Bu lisans başka bir bilgisayarda kullanımda. Cihaz değişikliği için bizimle iletişime geçin.'),
        { statusCode: 409 },
      );
    }

    if (license.expiresAt < new Date()) {
      throw Object.assign(new Error('Üyelik süreniz dolmuş. Lütfen süre uzatın.'), { statusCode: 402 });
    }

    // Tek ve kosullu write hem ilk cihaz yarısını hem de aynı cihazdan yeniden
    // aktivasyonu kapsar. Superadmin tam bu arada suspend/revoke/reset/rebind
    // yaparsa eski snapshot ile terminal durum ASLA ACTIVE'e geri yazilmaz.
    const now = new Date();
    const activated = await prisma.license.updateMany({
      where: {
        id: license.id,
        status: { in: ['PENDING', 'ACTIVE'] },
        expiresAt: { gte: now },
        OR: [{ hardwareId: null }, { hardwareId: input.hardwareId }],
      },
      data: {
        status: 'ACTIVE',
        hardwareId: input.hardwareId,
        hardwareIdShort: input.hardwareIdShort ?? license.hardwareIdShort,
        activatedAt: license.activatedAt ?? now,
        lastHeartbeatAt: now,
        lastHeartbeatIp: input.ip ?? null,
        appVersion: input.appVersion ?? null,
      },
    });

    const updated = await prisma.license.findUnique({
      where: { id: license.id },
      include: { tenant: { select: { name: true, isActive: true } } },
    });

    if (!updated) {
      throw Object.assign(new Error('Lisans anahtarı geçersiz.'), { statusCode: 404 });
    }

    if (activated.count !== 1 || !isActivationEligible(updated, input.hardwareId, now)) {
      if (updated.status === 'REVOKED') {
        throw Object.assign(new Error('Bu lisans iptal edilmiş. Lütfen bizimle iletişime geçin.'), {
          statusCode: 403,
        });
      }
      if (updated.status === 'SUSPENDED') {
        throw Object.assign(new Error('Lisansınız askıya alınmış. Lütfen bizimle iletişime geçin.'), {
          statusCode: 403,
        });
      }
      if (updated.hardwareId && updated.hardwareId !== input.hardwareId) {
        await flagSuspicious(updated.id, 'es zamanli cihaz degisikligi veya aktivasyon denemesi');
        throw Object.assign(new Error('Bu lisans başka bir bilgisayarda kullanımda.'), {
          statusCode: 409,
        });
      }
      if (updated.expiresAt < now) {
        throw Object.assign(new Error('Üyelik süreniz dolmuş. Lütfen süre uzatın.'), { statusCode: 402 });
      }
      throw Object.assign(new Error('Lisans durumu değişti. Lütfen yeniden deneyin.'), { statusCode: 409 });
    }

    logger.info(`Lisans aktive edildi: ${updated.id} -> ${updated.tenant.name}`);

    return {
      license: sign(
        { ...updated, hardwareId: input.hardwareId, tenantActive: updated.tenant.isActive },
        normalizedKey,
      ),
      syncToken: menuSyncToken({ ...updated, hardwareId: input.hardwareId }),
      serverTime: new Date().toISOString(),
      heartbeatIntervalHours: HEARTBEAT_INTERVAL_HOURS,
    };
  },

  /**
   * Yoklama — lokal taraf saatte bir cagirir.
   *
   * Her yoklamada YENIDEN imzalanmis lisans doner. Boylece superadmin
   * sureyi uzattiginda musterinin hicbir sey yapmasina gerek kalmaz;
   * en gec bir saat icinde yeni sure kendiliginden gecerli olur.
   */
  async heartbeat(input: HeartbeatInput) {
    const { license, normalizedKey } = await findLicenseByRawKey(input.licenseKey);

    if (!license) {
      throw Object.assign(new Error('Lisans anahtarı geçersiz.'), { statusCode: 404 });
    }

    if (!isHeartbeatEligible(license, input.hardwareId)) {
      if (!license.hardwareId || license.status === 'PENDING') {
        throw Object.assign(new Error('Lisans aktivasyonu gerekli.'), { statusCode: 409 });
      }
      await flagSuspicious(license.id, 'farkli donanimdan yoklama');
      throw Object.assign(new Error('Lisans bu cihaza tanımlı değil.'), { statusCode: 409 });
    }

    // Reset/rebind ile ayni anda gelen heartbeat eski snapshot'a dayanamaz:
    // write aninda cihaz bagi ve PENDING olmama sarti tekrar kontrol edilir.
    const touched = await prisma.license.updateMany({
      where: {
        id: license.id,
        hardwareId: input.hardwareId,
        status: { not: 'PENDING' },
      },
      data: {
        lastHeartbeatAt: new Date(),
        lastHeartbeatIp: input.ip ?? null,
        appVersion: input.appVersion ?? license.appVersion,
      },
    });

    const updated = await prisma.license.findUnique({
      where: { id: license.id },
      include: { tenant: { select: { name: true, isActive: true } } },
    });

    if (!updated) {
      throw Object.assign(new Error('Lisans anahtarı geçersiz.'), { statusCode: 404 });
    }
    if (touched.count !== 1 || !isHeartbeatEligible(updated, input.hardwareId)) {
      if (!updated.hardwareId || updated.status === 'PENDING') {
        throw Object.assign(new Error('Lisans aktivasyonu gerekli.'), { statusCode: 409 });
      }
      if (updated.hardwareId !== input.hardwareId) {
        await flagSuspicious(updated.id, 'yoklama sirasinda cihaz bagi degisti');
        throw Object.assign(new Error('Lisans bu cihaza tanımlı değil.'), { statusCode: 409 });
      }
      throw Object.assign(new Error('Lisans durumu değişti. Lütfen yeniden deneyin.'), { statusCode: 409 });
    }

    return {
      // Suspend/revoke/tenant pasif karari da imzali payload ile doner.
      // Lokal istemci bunu dogrulayip aninda kalici kilit durumuna gecer.
      license: sign({
        ...updated,
        hardwareId: input.hardwareId,
        tenantActive: updated.tenant.isActive,
      }, normalizedKey),
      syncToken: menuSyncToken({ ...updated, hardwareId: input.hardwareId }),
      serverTime: new Date().toISOString(),
      heartbeatIntervalHours: HEARTBEAT_INTERVAL_HOURS,
    };
  },
};
