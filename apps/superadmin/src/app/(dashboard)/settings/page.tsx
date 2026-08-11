'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Database, MailCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import styles from './page.module.css';

type CheckState = 'checking' | 'ready' | 'failed' | 'unknown';
type StatusKey = 'api' | 'database' | 'session' | 'mfa';

interface StatusItem {
  state: CheckState;
  label: string;
  detail: string;
}

type StatusSnapshot = Record<StatusKey, StatusItem>;

const CHECKING: StatusSnapshot = {
  api: { state: 'checking', label: 'Kontrol ediliyor…', detail: 'Control API yanıtı bekleniyor.' },
  database: { state: 'checking', label: 'Kontrol ediliyor…', detail: 'Veritabanı sorgusu bekleniyor.' },
  session: { state: 'checking', label: 'Kontrol ediliyor…', detail: 'Oturum doğrulanıyor.' },
  mfa: { state: 'checking', label: 'Kontrol ediliyor…', detail: 'MFA kanıtı doğrulanıyor.' },
};

function failed(label: string, detail: string): StatusItem {
  return { state: 'failed', label, detail };
}

export default function SettingsPage() {
  const [items, setItems] = useState<StatusSnapshot>(CHECKING);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const runChecks = useCallback(async () => {
    setRefreshing(true);
    setItems(CHECKING);
    const [readyResult, sessionResult] = await Promise.allSettled([
      fetch('/api/backend/ready', { cache: 'no-store', credentials: 'same-origin' }),
      fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' }),
    ]);

    let api = failed('Erişilemiyor', 'Control API geçerli bir hazır yanıtı vermedi.');
    let database = failed('Doğrulanamadı', 'Control veritabanı sorgusu doğrulanamadı.');
    if (readyResult.status === 'fulfilled') {
      try {
        const payload = await readyResult.value.json() as {
          success?: unknown;
          runtime?: unknown;
          database?: unknown;
        };
        const apiReady = readyResult.value.ok && payload.success === true && payload.runtime === 'cloud';
        const databaseReady = apiReady && payload.database === 'ready';
        api = apiReady
          ? { state: 'ready', label: 'Erişilebilir', detail: 'Cloud runtime hazır yanıtı doğrulandı.' }
          : api;
        database = databaseReady
          ? { state: 'ready', label: 'Sorgu başarılı', detail: 'Control API canlı SELECT 1 sorgusunu tamamladı.' }
          : database;
      } catch {
        // Varsayilan fail-closed durum korunur.
      }
    }

    let session = failed('Geçersiz', 'Aktif SUPER_ADMIN oturumu doğrulanamadı.');
    let mfa: StatusItem = { state: 'unknown', label: 'Doğrulanamadı', detail: 'MFA oturum kanıtı alınamadı.' };
    if (sessionResult.status === 'fulfilled') {
      try {
        const payload = await sessionResult.value.json() as {
          state?: unknown;
          user?: { role?: unknown };
          security?: { mfaVerified?: unknown; httpOnlySession?: unknown; secureTransport?: unknown; sameSite?: unknown };
        };
        const authenticated = payload.state === 'authenticated' && payload.user?.role === 'SUPER_ADMIN';
        const secureSession = authenticated
          && payload.security?.httpOnlySession === true
          && payload.security?.secureTransport === true
          && payload.security?.sameSite === 'strict';
        session = secureSession
          ? { state: 'ready', label: 'Doğrulanmış', detail: 'SUPER_ADMIN oturumu HttpOnly, Secure ve SameSite=Strict.' }
          : authenticated
            ? failed('Politika eksik', 'Oturum geçerli ancak üretim çerez politikası doğrulanamadı.')
            : session;
        mfa = authenticated && payload.security?.mfaVerified === true
          ? { state: 'ready', label: 'Bu oturumda doğrulandı', detail: 'Oturum, tek kullanımlık e-posta kodu doğrulandıktan sonra açıldı.' }
          : failed('Doğrulanmadı', 'Bu oturum için e-posta MFA kanıtı bulunamadı.');
      } catch {
        // Varsayilan fail-closed durum korunur.
      }
    }

    setItems({ api, database, session, mfa });
    setCheckedAt(new Date().toISOString());
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void runChecks();
  }, [runChecks]);

  const cards = [
    { key: 'api' as const, title: 'Control API', copy: 'Yönetim servisinin canlı hazır olma durumu', icon: Activity },
    { key: 'database' as const, title: 'Control Veritabanı', copy: 'Bulut lisans ve müşteri veritabanına canlı sorgu', icon: Database },
    { key: 'session' as const, title: 'Yönetici Oturumu', copy: 'Mevcut SUPER_ADMIN oturumu ve çerez politikası', icon: ShieldCheck },
    { key: 'mfa' as const, title: 'E-posta Doğrulaması', copy: 'Mevcut oturumun tek kullanımlık kod doğrulaması', icon: MailCheck },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1>Sistem Ayarları</h1>
          <p>Bu göstergeler varsayılan değer değil; her yenilemede canlı olarak doğrulanır.</p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void runChecks()} disabled={refreshing}>
          <RefreshCw size={16} className={refreshing ? styles.spinning : ''} />
          Yeniden kontrol et
        </button>
      </div>

      <div className={styles.grid}>
        {cards.map(({ key, title, copy, icon: Icon }) => {
          const item = items[key];
          return (
            <section className={styles.card} key={key}>
              <div className={styles.icon}><Icon size={22} /></div>
              <div>
                <h2>{title}</h2>
                <p>{copy}</p>
                <span className={`${styles.status} ${item.state === 'ready' ? styles.ready : item.state === 'failed' ? styles.error : item.state === 'unknown' ? styles.warning : ''}`}>
                  {item.label}
                </span>
                <small className={styles.detail}>{item.detail}</small>
              </div>
            </section>
          );
        })}
      </div>
      {checkedAt && <p className={styles.checkedAt}>Son canlı kontrol: {new Date(checkedAt).toLocaleString('tr-TR')}</p>}
    </div>
  );
}
