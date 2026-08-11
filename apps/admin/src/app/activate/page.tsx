'use client';

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  DatabaseBackup,
  Eye,
  EyeOff,
  HardDrive,
  Headphones,
  KeyRound,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  Wifi,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import styles from './page.module.css';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
const LICENSE_KEY_PATTERN = /^RSTO(?:-[A-HJ-NP-Z2-9]{4}){3}$/;

type LicenseState =
  | 'valid'
  | 'expired'
  | 'grace_exceeded'
  | 'license_disabled'
  | 'hardware_mismatch'
  | 'invalid_signature'
  | 'malformed'
  | 'unsupported_version'
  | 'clock_tampered';

type LicenseEntitlement = 'active' | 'suspended' | 'revoked' | 'tenant_disabled';

interface LocalLicenseStatus {
  state: LicenseState;
  operational: boolean;
  activationRequired: boolean;
  message: string;
  restaurantName?: string;
  expiresAt?: string;
  daysLeft?: number;
  entitlement?: LicenseEntitlement;
  lastCheckedAt: string;
  nextHeartbeatAt?: string;
  setupRequired?: boolean;
  setupSession?: {
    accessToken: string;
    user: {
      id: string;
      tenantId: string;
      email: string;
      name: string;
      role: 'OWNER';
      sessionType: 'local_setup';
    };
  };
}

interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data?: T;
}

type StatusTone = 'neutral' | 'warning' | 'danger' | 'success';

interface StatusCopy {
  eyebrow: string;
  title: string;
  detail: string;
  nextStep: string;
  tone: StatusTone;
  icon: typeof ShieldCheck;
}

function formatLicenseKey(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  return raw.match(/.{1,4}/g)?.join('-') ?? '';
}

function formatDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

function copyForStatus(status: LocalLicenseStatus | null): StatusCopy {
  if (!status) {
    return {
      eyebrow: 'Yerel çalışma alanı',
      title: 'Lisans durumuna bağlanılıyor',
      detail: 'Bu bilgisayardaki REST_OTM servisi kontrol ediliyor.',
      nextStep: 'Servis yanıt verdiğinde durum otomatik olarak güncellenecek.',
      tone: 'neutral',
      icon: Wifi,
    };
  }

  if (status.setupRequired) {
    return {
      eyebrow: 'Son kurulum adımı',
      title: 'İlk yöneticiyi oluşturun',
      detail: status.message,
      nextStep: 'Bu hesap yalnızca müşterinin bilgisayarındaki yerel veritabanına kaydedilir.',
      tone: 'neutral',
      icon: UserRound,
    };
  }

  if (status.state === 'valid') {
    return {
      eyebrow: 'Sistem hazır',
      title: 'Lisans doğrulandı',
      detail: status.message,
      nextStep: 'Güvenli giriş ekranına yönlendiriliyorsunuz.',
      tone: 'success',
      icon: ShieldCheck,
    };
  }

  switch (status.state) {
    case 'expired':
      return {
        eyebrow: 'Süre doldu',
        title: 'Lisans sürenizi yenileyin',
        detail: 'Üyelik süresi sona erdiği için operasyon ekranları güvenli biçimde kilitlendi.',
        nextStep: 'Süre uzatıldıktan sonra “Durumu yeniden kontrol et” seçeneğini kullanın.',
        tone: 'warning',
        icon: Clock3,
      };
    case 'grace_exceeded':
      return {
        eyebrow: 'Bağlantı gerekli',
        title: 'Çevrimdışı kullanım süresi doldu',
        detail: 'Sistem lisans merkezine izin verilen sürede ulaşamadı. Restoran verileriniz bu bilgisayarda güvende.',
        nextStep: 'İnternet bağlantısını kontrol edin ve lisans durumunu yeniden yoklayın.',
        tone: 'warning',
        icon: Wifi,
      };
    case 'license_disabled': {
      if (status.entitlement === 'suspended') {
        return {
          eyebrow: 'Askıya alındı',
          title: 'Lisans geçici olarak durduruldu',
          detail: 'Bu kurulumun kullanım yetkisi lisans merkezi tarafından askıya alındı.',
          nextStep: 'Hesap durumunu netleştirmek için yetkili destek ekibiyle iletişime geçin.',
          tone: 'danger',
          icon: ShieldAlert,
        };
      }
      if (status.entitlement === 'revoked') {
        return {
          eyebrow: 'İptal edildi',
          title: 'Bu lisans artık kullanılamaz',
          detail: 'Lisans kalıcı olarak iptal edildi. Aynı anahtar yeniden etkinleştirilemez.',
          nextStep: 'Yeni bir lisans anahtarı için yetkili destek ekibiyle iletişime geçin.',
          tone: 'danger',
          icon: LockKeyhole,
        };
      }
      return {
        eyebrow: 'Erişim durduruldu',
        title: 'Lisans aktif değil',
        detail: 'İşletme veya lisans yetkisi merkezden devre dışı bırakıldı.',
        nextStep: 'Hesap durumunu netleştirmek için yetkili destek ekibiyle iletişime geçin.',
        tone: 'danger',
        icon: ShieldAlert,
      };
    }
    case 'hardware_mismatch':
      return {
        eyebrow: 'Cihaz eşleşmedi',
        title: 'Lisans başka bir bilgisayara bağlı',
        detail: 'Her lisans yalnızca etkinleştirildiği işletme bilgisayarında çalışır.',
        nextStep: 'Cihaz değişikliği yaptıysanız lisans bağını güvenli biçimde sıfırlatın.',
        tone: 'danger',
        icon: HardDrive,
      };
    case 'clock_tampered':
      return {
        eyebrow: 'Saat doğrulanamadı',
        title: 'Bilgisayarın tarih ve saatini düzeltin',
        detail: 'Geri alınmış veya belirgin biçimde hatalı sistem saati lisans güvenliğini devre dışı bırakır.',
        nextStep: 'Windows’ta otomatik saat eşitlemesini açın, ardından tekrar kontrol edin.',
        tone: 'warning',
        icon: Clock3,
      };
    case 'unsupported_version':
      return {
        eyebrow: 'Güncelleme gerekli',
        title: 'REST_OTM sürümü güncel değil',
        detail: 'Bu lisans, kurulu uygulamadan daha yeni bir lisans biçimi kullanıyor.',
        nextStep: 'İmzalı uygulama güncellemesini kurduktan sonra yeniden deneyin.',
        tone: 'warning',
        icon: RefreshCw,
      };
    case 'invalid_signature':
      return {
        eyebrow: 'Doğrulama başarısız',
        title: 'Lisans dosyasının imzası geçersiz',
        detail: 'Değiştirilmiş veya doğrulanamayan bir lisans dosyası güvenlik nedeniyle kabul edilmedi.',
        nextStep: 'Dosyayı elle değiştirmeyin; destek ekibiyle güvenli kurtarma işlemi başlatın.',
        tone: 'danger',
        icon: ShieldAlert,
      };
    case 'malformed':
    default:
      return {
        eyebrow: 'İlk kurulum',
        title: 'Bu bilgisayarı etkinleştirin',
        detail: 'REST_OTM verileri bu işletmenin bilgisayarında tutulur. Başlamak için size verilen lisans anahtarını girin.',
        nextStep: 'Aktivasyon için bu bilgisayarda kısa süreli internet bağlantısı gerekir.',
        tone: 'neutral',
        icon: KeyRound,
      };
  }
}

async function readEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  try {
    return (await response.json()) as ApiEnvelope<T>;
  } catch {
    return { success: false, message: 'Yerel servis geçerli bir yanıt vermedi.' };
  }
}

export default function ActivatePage() {
  const router = useRouter();
  const [status, setStatus] = useState<LocalLicenseStatus | null>(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isActivating, setIsActivating] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [serviceUnavailable, setServiceUnavailable] = useState(false);

  const goToLogin = useCallback(() => {
    router.replace('/');
    router.refresh();
  }, [router]);

  const applyStatus = useCallback((nextStatus: LocalLicenseStatus) => {
    setStatus(nextStatus);
    setServiceUnavailable(false);
    if (nextStatus.operational) {
      window.setTimeout(goToLogin, 900);
    }
  }, [goToLogin]);

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    setIsChecking(true);
    setFeedback('');
    try {
      const response = await fetch(`${API_BASE_URL}/local-license/status`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal,
      });
      const envelope = await readEnvelope<LocalLicenseStatus>(response);
      if (!response.ok || !envelope.success || !envelope.data) {
        throw new Error(envelope.message || 'Lisans durumu alınamadı.');
      }
      applyStatus(envelope.data);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setServiceUnavailable(true);
      setFeedback('Yerel REST_OTM servisine ulaşılamadı. Uygulama servisini kontrol edip yeniden deneyin.');
    } finally {
      if (!signal?.aborted) setIsChecking(false);
    }
  }, [applyStatus]);

  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, [loadStatus]);

  useEffect(() => {
    if (!showKey) return;
    const hideKey = () => setShowKey(false);
    const timer = window.setTimeout(hideKey, 15_000);
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') hideKey();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [showKey]);

  const retryHeartbeat = async () => {
    setIsChecking(true);
    setFeedback('');
    try {
      const response = await fetch(`${API_BASE_URL}/local-license/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      const envelope = await readEnvelope<LocalLicenseStatus>(response);
      if (!response.ok || !envelope.success || !envelope.data) {
        throw new Error(envelope.message || 'Lisans merkeziyle bağlantı kurulamadı.');
      }
      applyStatus(envelope.data);
      if (!envelope.data.operational) {
        setFeedback(envelope.data.message || 'Lisans henüz kullanıma açılmadı.');
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Lisans durumu yenilenemedi.');
    } finally {
      setIsChecking(false);
    }
  };

  const activate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formattedKey = formatLicenseKey(licenseKey);
    if (!LICENSE_KEY_PATTERN.test(formattedKey)) {
      setFeedback('Anahtarı RSTO-XXXX-XXXX-XXXX biçiminde eksiksiz girin.');
      return;
    }
    setIsActivating(true);
    setFeedback('');
    try {
      const response = await fetch(`${API_BASE_URL}/local-license/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ licenseKey: formattedKey }),
      });
      const envelope = await readEnvelope<LocalLicenseStatus>(response);
      if (envelope.data) applyStatus(envelope.data);
      if (!response.ok || !envelope.success) {
        throw new Error(envelope.message || 'Lisans etkinleştirilemedi.');
      }
      if (envelope.data?.setupSession) {
        localStorage.setItem('accessToken', envelope.data.setupSession.accessToken);
        localStorage.removeItem('refreshToken');
        localStorage.setItem('user', JSON.stringify(envelope.data.setupSession.user));
        window.location.replace('/staff');
        return;
      }
      setShowKey(false);
      setLicenseKey('');
      setFeedback('Lisans doğrulandı. Güvenli giriş ekranı hazırlanıyor…');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Lisans etkinleştirilemedi.');
    } finally {
      setIsActivating(false);
    }
  };

  const statusCopy = useMemo(() => copyForStatus(status), [status]);
  const StatusIcon = statusCopy.icon;
  const expiresAt = formatDate(status?.expiresAt);
  const lastCheckedAt = formatDate(status?.lastCheckedAt);
  const formBusy = isActivating || isChecking;

  return (
    <main className={styles.shell}>
      <div className={styles.ambient} aria-hidden="true">
        <span className={styles.orbitOne} />
        <span className={styles.orbitTwo} />
        <span className={styles.grain} />
      </div>

      <header className={styles.brandBar}>
        <div className={styles.brandMark} aria-hidden="true">R</div>
        <div>
          <p className={styles.brand}>REST_OTM</p>
          <p className={styles.brandMeta}>Yerel işletme sistemi</p>
        </div>
        <div className={styles.localBadge}>
          <span className={styles.localPulse} aria-hidden="true" />
          Bu bilgisayarda çalışır
        </div>
      </header>

      <section className={styles.workspace} aria-labelledby="activation-title">
        <aside className={`${styles.statusPanel} ${styles[statusCopy.tone]}`}>
          <div className={styles.statusTopline}>
            <span className={styles.statusIcon}><StatusIcon size={22} strokeWidth={1.8} /></span>
            <span>{statusCopy.eyebrow}</span>
          </div>
          <h1 id="activation-title">{statusCopy.title}</h1>
          <p className={styles.statusDetail}>{statusCopy.detail}</p>

          <div className={styles.statusNote}>
            <ArrowRight size={17} aria-hidden="true" />
            <p>{statusCopy.nextStep}</p>
          </div>

          <dl className={styles.statusFacts}>
            <div>
              <dt>Kurulum</dt>
              <dd>{status?.restaurantName || 'Bu işletme bilgisayarı'}</dd>
            </div>
            <div>
              <dt>Son kontrol</dt>
              <dd>{lastCheckedAt || (isChecking ? 'Kontrol ediliyor' : 'Henüz doğrulanmadı')}</dd>
            </div>
            {expiresAt && (
              <div>
                <dt>Lisans bitişi</dt>
                <dd>{expiresAt}</dd>
              </div>
            )}
          </dl>

          <div className={styles.localPromise}>
            <DatabaseBackup size={19} aria-hidden="true" />
            <p><strong>Verileriniz yerelde kalır.</strong> Siparişler ve işletme kayıtları bu bilgisayardaki veritabanında tutulur.</p>
          </div>
        </aside>

        <div className={styles.actionPanel}>
          <div className={styles.actionHeading}>
            <span>Güvenli aktivasyon</span>
            <h2>Lisans anahtarınızı girin</h2>
            <p>Anahtar yalnızca bu kurulumun lisans servisine gönderilir ve tek bilgisayara bağlanır.</p>
          </div>

          <form className={styles.form} onSubmit={activate} noValidate>
            <label htmlFor="license-key">Lisans anahtarı</label>
            <div className={styles.keyField}>
              <KeyRound size={19} className={styles.keyIcon} aria-hidden="true" />
              <input
                id="license-key"
                name="licenseKey"
                type={showKey ? 'text' : 'password'}
                value={licenseKey}
                onChange={(event) => setLicenseKey(formatLicenseKey(event.target.value))}
                placeholder="RSTO-XXXX-XXXX-XXXX"
                autoComplete="new-password"
                autoCapitalize="characters"
                spellCheck={false}
                inputMode="text"
                maxLength={19}
                aria-describedby="key-help activation-feedback"
                disabled={isActivating}
              />
              <button
                type="button"
                className={styles.revealButton}
                onClick={() => setShowKey((current) => !current)}
                aria-label={showKey ? 'Lisans anahtarını gizle' : 'Lisans anahtarını göster'}
                aria-pressed={showKey}
              >
                {showKey ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
              </button>
            </div>
            <p id="key-help" className={styles.fieldHelp}>Anahtarınız RSTO ile başlar ve toplam dört bloktan oluşur.</p>

            <button type="submit" className={styles.primaryButton} disabled={formBusy || !licenseKey}>
              {isActivating ? <Loader2 className={styles.spinner} size={19} /> : <ShieldCheck size={19} />}
              {isActivating ? 'Doğrulanıyor…' : 'Bu bilgisayarı etkinleştir'}
            </button>

            <button type="button" className={styles.secondaryButton} onClick={retryHeartbeat} disabled={formBusy}>
              {isChecking ? <Loader2 className={styles.spinner} size={18} /> : <RefreshCw size={18} />}
              Durumu yeniden kontrol et
            </button>
          </form>

          <div
            id="activation-feedback"
            className={`${styles.feedback} ${serviceUnavailable ? styles.feedbackDanger : ''}`}
            role={feedback ? 'alert' : 'status'}
            aria-live="polite"
            aria-atomic="true"
          >
            {feedback ? (
              <><AlertTriangle size={17} aria-hidden="true" /><span>{feedback}</span></>
            ) : status?.operational ? (
              <><CheckCircle2 size={17} aria-hidden="true" /><span>Sistem kullanıma hazır.</span></>
            ) : (
              <><ShieldCheck size={17} aria-hidden="true" /><span>Anahtarınız bu cihaz için şifreli imzayla doğrulanır.</span></>
            )}
          </div>

          <section className={styles.recovery} aria-labelledby="recovery-title">
            <div className={styles.recoveryHeading}>
              <h3 id="recovery-title">Kurtarma seçenekleri</h3>
              <span>Veri kaybını önleme</span>
            </div>
            <div className={styles.recoveryGrid}>
              <button type="button" disabled aria-describedby="backup-note">
                <DatabaseBackup size={18} />
                <span>Yedek dışa aktar</span>
              </button>
              <button type="button" disabled aria-describedby="support-note">
                <Headphones size={18} />
                <span>Destek paketi</span>
              </button>
            </div>
            <p id="backup-note">Yedek indirme, yetkili kullanıcı oturumu doğrulandıktan sonra açılır.</p>
            <p id="support-note">Destek paketi kurulumu tamamlandığında bu alandan güvenle üretilecek.</p>
          </section>
        </div>
      </section>

      <footer className={styles.footer}>
        <span><LockKeyhole size={14} /> İmzalı lisans</span>
        <span><HardDrive size={14} /> Cihaza özel</span>
        <span><ShieldCheck size={14} /> Yerel veri</span>
      </footer>
    </main>
  );
}
