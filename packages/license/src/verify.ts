// ==========================================
// Lisans dogrulama — MUSTERININ bilgisayarinda calisir
// ==========================================
// Bu dosya yalnizca ACIK anahtari kullanir. Ozel anahtar buraya asla
// girmez; girseydi musteri kendi lisansini uretebilirdi.
//
// Guvenlik dayanagi: kod okunabilir olsa bile, imza uretmek icin ozel
// anahtar gerekir ve o yalnizca lisans sunucusundadir. Karartma/paketleme
// isin sadece "ugrasilmasin" kismidir; asil koruma buradaki imzadir.

import { verify as edVerify } from 'crypto';
import {
  LICENSE_FORMAT_VERSION,
  LicenseEntitlement,
  LicensePayload,
  LicenseState,
  LicenseStatus,
  SignedLicense,
} from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Yerel saatin ne kadar geri gitmesine goz yumulacagi.
 * Yaz/kis saati, NTP duzeltmesi ve saat dilimi hatalari birkac saatlik
 * sapma yaratabilir; bunlari kurcalama saymak yanlis alarm uretir.
 */
const CLOCK_TOLERANCE_MS = 12 * 60 * 60 * 1000;
const ENTITLEMENTS: LicenseEntitlement[] = ['active', 'suspended', 'revoked', 'tenant_disabled'];

export interface VerifyOptions {
  /** PEM formatinda Ed25519 acik anahtari. */
  publicKeyPem: string;
  /** Bu makinenin parmak izi (bkz. hardware.ts). */
  hardwareId: string;
  /** Yerel durum kaydi. Yoksa ilk calistirma kabul edilir. */
  state?: LicenseState;
  /** Test edilebilirlik icin; uretimde verilmez. */
  now?: Date;
}

/**
 * Imzalanmis lisansi dogrular ve sistemin ne yapmasi gerektigini soyler.
 *
 * Kontroller BILEREK su sirada: once ucuz ve kesin olanlar (format, imza),
 * sonra baglam gerektirenler (donanim, saat, sure). Boylece kurcalanmis
 * bir lisans, sure hesabina hic girmeden reddedilir.
 */
export function verifyLicense(signed: SignedLicense, opts: VerifyOptions): LicenseStatus {
  const now = opts.now ?? new Date();

  // ─── 1. Bicim ────────────────────────────────────────────────────
  if (!signed?.payload || !signed?.signature) {
    return { state: 'malformed', reason: 'payload veya signature eksik' };
  }

  // ─── 2. Imza ─────────────────────────────────────────────────────
  // Sure ve donanim kontrollerinden ONCE: imzasi gecersiz bir lisansin
  // icindeki hicbir degere guvenilemez.
  let signatureOk = false;
  try {
    signatureOk = edVerify(
      null, // Ed25519 kendi ozetini kullanir, ayrica hash algoritmasi verilmez
      Buffer.from(signed.payload, 'utf8'),
      opts.publicKeyPem,
      Buffer.from(signed.signature, 'base64url'),
    );
  } catch {
    return { state: 'invalid_signature' };
  }
  if (!signatureOk) return { state: 'invalid_signature' };

  // ─── 3. Ayristirma ───────────────────────────────────────────────
  let license: LicensePayload;
  try {
    license = JSON.parse(signed.payload) as LicensePayload;
  } catch {
    return { state: 'malformed', reason: 'payload gecerli JSON degil' };
  }

  if (!Number.isInteger(license.v) || license.v < 1) {
    return { state: 'malformed', reason: 'lisans surumu gecersiz' };
  }
  if (license.v > LICENSE_FORMAT_VERSION) {
    // Ileri surum: istemci guncellenmeli. Tahmin yurutup yanlis
    // yorumlamaktansa acikca reddetmek dogru.
    return { state: 'unsupported_version', version: license.v };
  }

  const requiredStrings: Array<keyof LicensePayload> = [
    'licenseKey',
    'tenantId',
    'restaurantName',
    'hardwareId',
    'issuedAt',
    'expiresAt',
  ];
  if (requiredStrings.some((key) => typeof license[key] !== 'string' || !(license[key] as string).trim())) {
    return { state: 'malformed', reason: 'zorunlu lisans alani eksik' };
  }
  if (!Number.isInteger(license.graceDays) || license.graceDays < 0 || license.graceDays > 30) {
    return { state: 'malformed', reason: 'graceDays gecersiz' };
  }
  if (!Array.isArray(license.features) || license.features.some((feature) => typeof feature !== 'string')) {
    return { state: 'malformed', reason: 'features gecersiz' };
  }

  // v1 lisanslarda bu alanlar yoktu. Eski imzali lisanslar aktif kabul
  // edilir; offline sonu imzali issuedAt + graceDays degerinden turetilir.
  const entitlement = license.entitlement ?? 'active';
  if (!ENTITLEMENTS.includes(entitlement)) {
    return { state: 'malformed', reason: 'entitlement gecersiz' };
  }

  // ─── 4. Donanim baglamasi ────────────────────────────────────────
  if (license.hardwareId !== opts.hardwareId) {
    return {
      state: 'hardware_mismatch',
      expected: license.hardwareId,
      actual: opts.hardwareId,
    };
  }

  if (entitlement !== 'active') {
    return { state: 'license_disabled', license, entitlement };
  }

  // ─── 5. Saat kurcalama ───────────────────────────────────────────
  // Yerel saati geri almak, suresi dolmus bir lisansi tekrar gecerli
  // gostermenin en kolay yoludur. Gordugumuz en ileri zamani sakliyoruz;
  // saat bunun belirgin sekilde gerisine duserse kabul etmiyoruz.
  const issuedAt = new Date(license.issuedAt);
  if (Number.isNaN(issuedAt.getTime())) {
    return { state: 'malformed', reason: 'issuedAt okunamadi' };
  }
  if (now.getTime() < issuedAt.getTime() - CLOCK_TOLERANCE_MS) {
    return { state: 'clock_tampered', lastKnown: issuedAt, current: now };
  }
  if (opts.state?.highWaterMark) {
    const highWater = new Date(opts.state.highWaterMark);
    if (Number.isNaN(highWater.getTime())) {
      return { state: 'malformed', reason: 'yerel lisans durumu bozuk' };
    }
    if (now.getTime() < highWater.getTime() - CLOCK_TOLERANCE_MS) {
      return { state: 'clock_tampered', lastKnown: highWater, current: now };
    }
  }

  // ─── 6. Uyelik suresi ────────────────────────────────────────────
  const expiresAt = new Date(license.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return { state: 'malformed', reason: 'expiresAt okunamadi' };
  }
  if (now > expiresAt) {
    return { state: 'expired', license, expiredSince: expiresAt };
  }

  // ─── 7. Cevrimdisi tolerans ──────────────────────────────────────
  // Uyelik suresi devam ediyor ama sunucuya uzun suredir ulasilamiyorsa:
  // ya internet yok (mesru) ya da lisans sunucusu bilerek engellendi.
  // Ikisini ayirt edemeyiz; bu yuzden makul bir sure calismaya devam
  // edip sonra kilitliyoruz.
  const signedOfflineUntil = license.offlineUntil ? new Date(license.offlineUntil) : null;
  if (signedOfflineUntil && Number.isNaN(signedOfflineUntil.getTime())) {
    return { state: 'malformed', reason: 'offlineUntil okunamadi' };
  }
  const derivedOfflineUntil = new Date(
    Math.min(expiresAt.getTime(), issuedAt.getTime() + license.graceDays * MS_PER_DAY),
  );
  const offlineUntil = signedOfflineUntil ?? derivedOfflineUntil;
  if (offlineUntil.getTime() > expiresAt.getTime()) {
    return { state: 'malformed', reason: 'offlineUntil uyelik bitisini asiyor' };
  }
  if (now > offlineUntil) {
    return { state: 'grace_exceeded', license, lastSeen: issuedAt };
  }

  const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / MS_PER_DAY);
  return { state: 'valid', license, daysLeft };
}

/**
 * Durum kaydini gunceller. Sunucudan basarili yanit alindiginda cagrilir.
 * highWaterMark yalnizca ILERI gider — saat geri alinsa bile dusmez.
 */
export function advanceState(prev: LicenseState | undefined, serverTime: Date): LicenseState {
  const prevHigh = prev?.highWaterMark ? new Date(prev.highWaterMark) : new Date(0);
  const high = serverTime > prevHigh ? serverTime : prevHigh;
  return {
    lastHeartbeatAt: serverTime.toISOString(),
    highWaterMark: high.toISOString(),
  };
}

/** Kilit ekraninda gosterilecek, kullanicinin anlayacagi mesaj. */
export function statusMessage(status: LicenseStatus): string {
  switch (status.state) {
    case 'valid':
      return `Lisans geçerli. Kalan süre: ${status.daysLeft} gün.`;
    case 'expired':
      return 'Üyelik süreniz doldu. Sistemi kullanmaya devam etmek için süre uzatmanız gerekiyor.';
    case 'grace_exceeded':
      return 'Sistem uzun süredir lisans sunucusuna bağlanamadı. Lütfen internet bağlantınızı kontrol edin.';
    case 'license_disabled':
      return status.entitlement === 'suspended'
        ? 'Lisansınız askıya alınmış. Lütfen bizimle iletişime geçin.'
        : 'Lisansınız aktif değil. Lütfen bizimle iletişime geçin.';
    case 'hardware_mismatch':
      return 'Bu lisans başka bir bilgisayara tanımlı. Yeni cihaza taşımak için bizimle iletişime geçin.';
    case 'invalid_signature':
      return 'Lisans dosyası geçersiz. Lütfen bizimle iletişime geçin.';
    case 'malformed':
      return 'Lisans dosyası okunamadı. Lütfen bizimle iletişime geçin.';
    case 'unsupported_version':
      return 'Bu lisans daha yeni bir sürüm gerektiriyor. Lütfen programı güncelleyin.';
    case 'clock_tampered':
      return 'Bilgisayarın saati hatalı görünüyor. Lütfen tarih ve saati düzeltip tekrar deneyin.';
  }
}
