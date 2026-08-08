// ==========================================
// Lisans Istemcisi — MUSTERININ bilgisayarinda calisir
// ==========================================
// Yasam dongusu:
//   1. Ilk acilis  -> lisans dosyasi yok -> aktivasyon ekrani
//   2. Aktivasyon  -> buluta anahtar + donanim gonderilir, imzali lisans alinir
//   3. Her acilis  -> diskteki lisans dogrulanir, sonuca gore sistem acilir
//   4. Saatte bir  -> yoklama; basarili yanitta lisans YENIDEN yazilir
//                     (superadmin sureyi uzattiysa otomatik yansir)
//
// Ag hatalarinin sistemi durdurmamasi esastir: internet kesintisi
// mesru bir durumdur ve restoran calismaya devam etmelidir. Kilitleme
// yalnizca cevrimdisi tolerans suresi asildiginda devreye girer.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { computeHardwareId, shortHardwareId } from './hardware';
import { advanceState, verifyLicense } from './verify';
import { LicenseState, LicenseStatus, SignedLicense } from './types';

const LICENSE_FILE = 'license.json';
const STATE_FILE = 'license-state.json';

/** Yoklama istegi zaman asimi. Kisa tutuluyor: acilisi bekletmemeli. */
const REQUEST_TIMEOUT_MS = 15_000;

export interface ClientConfig {
  /** Lisans ve durum dosyalarinin tutulacagi klasor. */
  dataDir: string;
  /** Bulut lisans sunucusunun kok adresi, ornegin https://api.restoranyonetim.com */
  serverUrl: string;
  /** Pakete gomulu Ed25519 acik anahtari (PEM). */
  publicKeyPem: string;
  /** Uygulama surumu — sunucuda hangi surumun calistigi gorunsun diye. */
  appVersion: string;
}

export interface ActivationResult {
  ok: boolean;
  /** Basarisizsa kullaniciya gosterilecek mesaj. */
  message: string;
  status?: LicenseStatus;
}

// ─── Disk islemleri ────────────────────────────────────────────────

function licensePath(dir: string) {
  return join(dir, LICENSE_FILE);
}
function statePath(dir: string) {
  return join(dir, STATE_FILE);
}

export function readStoredLicense(dir: string): SignedLicense | null {
  try {
    return JSON.parse(readFileSync(licensePath(dir), 'utf8')) as SignedLicense;
  } catch {
    return null;
  }
}

export function readStoredState(dir: string): LicenseState | undefined {
  try {
    return JSON.parse(readFileSync(statePath(dir), 'utf8')) as LicenseState;
  } catch {
    // Grace suresi bu dosyaya degil, imzali lisans icindeki offlineUntil'a
    // dayanir. Dosyayi silmek veya bozmak cevrimdisi sureyi sifirlamaz.
    return undefined;
  }
}

function persist(dir: string, license: SignedLicense | null, state: LicenseState | null) {
  mkdirSync(dir, { recursive: true });
  const atomicWrite = (target: string, value: unknown) => {
    const temporary = `${target}.next`;
    writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(temporary, target);
  };
  if (license) atomicWrite(licensePath(dir), license);
  if (state) atomicWrite(statePath(dir), state);
}

// ─── Ag ────────────────────────────────────────────────────────────

interface ServerResponse {
  success: boolean;
  message?: string;
  data?: {
    license: SignedLicense;
    serverTime: string;
    heartbeatIntervalHours: number;
  };
}

async function post(url: string, body: unknown): Promise<ServerResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return (await res.json()) as ServerResponse;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Genel API ─────────────────────────────────────────────────────

/**
 * Diskteki lisansi dogrular. Aga CIKMAZ — acilista hizli olmasi icin.
 * Sonuc 'valid' degilse cagiran taraf kilit ekranini gosterir.
 */
export function checkLocalLicense(cfg: ClientConfig): LicenseStatus {
  const signed = readStoredLicense(cfg.dataDir);
  if (!signed) {
    return { state: 'malformed', reason: 'Lisans bulunamadı — etkinleştirme gerekiyor' };
  }

  return verifyLicense(signed, {
    publicKeyPem: cfg.publicKeyPem,
    hardwareId: computeHardwareId(),
    state: readStoredState(cfg.dataDir),
  });
}

/**
 * Ilk kurulumda kullanicinin girdigi anahtarla etkinlestirme yapar.
 * Basarili olursa lisans diske yazilir ve sistem calismaya hazir olur.
 */
export async function activate(cfg: ClientConfig, licenseKey: string): Promise<ActivationResult> {
  const hardwareId = computeHardwareId();

  let res: ServerResponse;
  try {
    res = await post(`${cfg.serverUrl}/api/license/activate`, {
      licenseKey: licenseKey.trim().toUpperCase(),
      hardwareId,
      hardwareIdShort: shortHardwareId(hardwareId),
      appVersion: cfg.appVersion,
    });
  } catch {
    // Aktivasyon internet GEREKTIRIR; burada tolerans yoktur cunku
    // henuz elimizde imzali bir lisans yok.
    return {
      ok: false,
      message: 'Lisans sunucusuna ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.',
    };
  }

  if (!res.success || !res.data) {
    return { ok: false, message: res.message ?? 'Etkinleştirme başarısız.' };
  }

  // Once dogrula, sonra diske yaz. Bozuk veya sahte bir sunucu yaniti son
  // bilinen iyi lisansi ezerek kalici hizmet kesintisi yaratmamalidir.
  const previousState = readStoredState(cfg.dataDir);
  const status = verifyLicense(res.data.license, {
    publicKeyPem: cfg.publicKeyPem,
    hardwareId,
    state: previousState,
  });

  if (status.state !== 'valid') {
    return { ok: false, message: 'Sunucudan geçersiz bir lisans alındı. Lütfen bizimle iletişime geçin.', status };
  }

  const state = advanceState(previousState, new Date(status.license.issuedAt));
  persist(cfg.dataDir, res.data.license, state);

  return { ok: true, message: 'Lisans etkinleştirildi.', status };
}

/**
 * Yoklama — periyodik olarak cagrilir.
 *
 * Ag hatasinda BASARISIZ SAYILMAZ: eldeki lisans hala gecerliyse sistem
 * calismaya devam eder. Yalnizca sunucu acikca "bu lisans gecersiz"
 * derse durum degisir.
 */
export async function heartbeat(cfg: ClientConfig): Promise<LicenseStatus> {
  const stored = readStoredLicense(cfg.dataDir);
  if (!stored) return checkLocalLicense(cfg);

  const hardwareId = computeHardwareId();
  let payload: { licenseKey?: string } = {};
  try {
    payload = JSON.parse(stored.payload);
  } catch {
    return checkLocalLicense(cfg);
  }

  try {
    const res = await post(`${cfg.serverUrl}/api/license/heartbeat`, {
      licenseKey: payload.licenseKey,
      hardwareId,
      appVersion: cfg.appVersion,
    });

    if (res.success && res.data) {
      const previousState = readStoredState(cfg.dataDir);
      const candidate = verifyLicense(res.data.license, {
        publicKeyPem: cfg.publicKeyPem,
        hardwareId,
        state: previousState,
      });

      // Imzasi ve cihazi dogru terminal durumlar da saklanir. Boylece
      // askıya alma/iptal karari geldiginde eski aktif lisansla devam edilmez.
      if (
        'license' in candidate &&
        ['valid', 'expired', 'grace_exceeded', 'license_disabled'].includes(candidate.state)
      ) {
        const state = advanceState(previousState, new Date(candidate.license.issuedAt));
        persist(cfg.dataDir, res.data.license, state);
        return candidate;
      }
    }
    // res.success false ise (lisans askiya alinmis vb.) diskteki lisansi
    // DEGISTIRMIYORUZ; asagidaki dogrulama zaten dogru sonucu verecek.
  } catch {
    // Ag hatasi — sessizce gec. Cevrimdisi tolerans devrede.
  }

  return checkLocalLicense(cfg);
}

/**
 * Periyodik yoklama dongusunu baslatir. Dondurdugu fonksiyon durdurur.
 * onChange yalnizca durum DEGISTIGINDE cagrilir; arayuz her saat
 * gereksiz yere yeniden cizilmesin.
 */
export function startHeartbeatLoop(
  cfg: ClientConfig,
  intervalHours: number,
  onChange: (status: LicenseStatus) => void,
): () => void {
  let lastState: string | null = null;

  const tick = async () => {
    const status = await heartbeat(cfg);
    if (status.state !== lastState) {
      lastState = status.state;
      onChange(status);
    }
  };

  void tick();
  const timer = setInterval(tick, Math.max(1, intervalHours) * 60 * 60 * 1000);
  // Node surecinin kapanmasini bu zamanlayici engellemesin.
  if (typeof timer.unref === 'function') timer.unref();

  return () => clearInterval(timer);
}
