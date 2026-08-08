// ==========================================
// Lisans veri modeli — bulut ve lokal ortak
// ==========================================
// Bu paket hem lisansi URETEN sunucu (bulut) hem de DOGRULAYAN istemci
// (musterinin bilgisayari) tarafindan kullanilir. Tek kaynak olmasi sart:
// iki tarafta ayri tanimlar olsaydi, bir alan degistiginde sessizce
// uyumsuz hale gelirlerdi.

/** Lisans formati surumu. Alan eklenirse artirilir; eski istemciler
 *  anlamadiklari surumu reddeder, yanlis yorumlamaz. */
export const LICENSE_FORMAT_VERSION = 2;

export type LicenseEntitlement =
  | 'active'
  | 'suspended'
  | 'revoked'
  | 'tenant_disabled';

export interface LicensePayload {
  /** Format surumu — ileri uyumluluk kontrolu icin. */
  v: number;

  /** Musteriye verilen, insan tarafindan okunabilir anahtar.
   *  Ornek: RSTO-4F2A-9C1B-7E30 */
  licenseKey: string;

  /** Bulut tarafindaki restoran kimligi. */
  tenantId: string;

  /** Kilit ekraninda ve destek yazismalarinda gosterilir. */
  restaurantName: string;

  /** Bu lisansin bagli oldugu makine. Ayni lisansla ikinci bir
   *  bilgisayarda calistirma girisimi burada yakalanir. */
  hardwareId: string;

  /** Lisansin uretildigi an (sunucu saati, ISO 8601). */
  issuedAt: string;

  /** Uyeligin bitis ani (ISO 8601). Bu tarihten sonra sistem kilitlenir. */
  expiresAt: string;

  /** Bulutun son yoklamada verdigi yetki durumu. */
  entitlement: LicenseEntitlement;

  /** Internet olmadan calisilabilecek imzali son an. expiresAt'i asmaz. */
  offlineUntil: string;

  /**
   * Internet kesildiginde kac gun calismaya devam edecegi.
   *
   * Neden var: yoklama basarisiz olunca sistemi hemen kilitlemek,
   * gercek bir internet kesintisinde restorani calisamaz hale getirir —
   * kabul edilemez. Sinirsiz beklemek ise "kabloyu cek, sonsuza kadar
   * kullan" demektir. Ikisinin arasi bu deger.
   */
  graceDays: number;

  /** Acik ozellikler (ornegin 'einvoice', 'pos', 'inventory').
   *  Paket bazli satis yapmak istendiginde kullanilir. */
  features: string[];
}

/** Imzalanmis lisans — diskte ve ag uzerinde bu sekilde tasinir. */
export interface SignedLicense {
  /** LicensePayload'in JSON hali. Imza tam olarak bu metin uzerinden
   *  hesaplanir; yeniden serilestirme yapilmaz cunku anahtar sirasi
   *  degisirse imza tutmaz. */
  payload: string;

  /** payload'in Ed25519 imzasi (base64url). */
  signature: string;
}

/** Dogrulama sonucu. */
export type LicenseStatus =
  | { state: 'valid'; license: LicensePayload; daysLeft: number }
  /** Imza gecerli ama uyelik suresi dolmus. */
  | { state: 'expired'; license: LicensePayload; expiredSince: Date }
  /** Cevrimdisi tolerans suresi de dolmus — yoklama sart. */
  | { state: 'grace_exceeded'; license: LicensePayload; lastSeen: Date }
  /** Bulut lisansi veya tenant'i acikca devre disi birakmis. */
  | { state: 'license_disabled'; license: LicensePayload; entitlement: LicenseEntitlement }
  /** Baska bir makineye ait lisans. */
  | { state: 'hardware_mismatch'; expected: string; actual: string }
  /** Imza gecersiz — kurcalanmis veya sahte. */
  | { state: 'invalid_signature' }
  /** Bozuk/okunamayan lisans dosyasi. */
  | { state: 'malformed'; reason: string }
  /** Istemci bu lisans surumunu tanimiyor — guncelleme gerekiyor. */
  | { state: 'unsupported_version'; version: number }
  /** Yerel saat geriye alinmis. */
  | { state: 'clock_tampered'; lastKnown: Date; current: Date };

/** Lisans dogrulanirken kullanilan yerel durum kaydi.
 *  Saat oynatma tespiti ve cevrimdisi sure hesabi buna dayanir. */
export interface LicenseState {
  /** Sunucudan alinan son basarili yoklama zamani (ISO 8601). */
  lastHeartbeatAt: string;

  /** Gorulen en ileri zaman. Yerel saat bunun gerisine duserse
   *  kullanici saati geri almis demektir. */
  highWaterMark: string;
}
