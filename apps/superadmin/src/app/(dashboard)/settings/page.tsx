'use client';

import { useEffect, useState } from 'react';
import { Activity, Database, MailCheck, ShieldCheck } from 'lucide-react';
import styles from './page.module.css';

type ControlStatus = 'loading' | 'ready' | 'unavailable';

export default function SettingsPage() {
  const [status, setStatus] = useState<ControlStatus>('loading');

  useEffect(() => {
    const controller = new AbortController();

    async function checkControlPlane() {
      try {
        const response = await fetch('/api/backend/ready', {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        const ready = response.ok
          && payload !== null
          && typeof payload === 'object'
          && (payload as { success?: unknown }).success === true
          && (payload as { database?: unknown }).database === 'ready';
        setStatus(ready ? 'ready' : 'unavailable');
      } catch {
        if (!controller.signal.aborted) setStatus('unavailable');
      }
    }

    void checkControlPlane();
    return () => controller.abort();
  }, []);

  const statusLabel = status === 'loading'
    ? 'Kontrol ediliyor…'
    : status === 'ready'
      ? 'Çalışıyor'
      : 'Bağlantı kurulamadı';

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Sistem Ayarları</h1>
        <p>Kontrol düzlemi ve yönetici güvenlik yapılandırmasının durumu.</p>
      </div>

      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.icon}><Activity size={22} /></div>
          <div>
            <h2>Control API</h2>
            <p>Yönetim servisinin erişilebilirlik durumu</p>
            <span className={`${styles.status} ${status === 'ready' ? styles.ready : status === 'unavailable' ? styles.error : ''}`}>
              {statusLabel}
            </span>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.icon}><Database size={22} /></div>
          <div>
            <h2>Control Veritabanı</h2>
            <p>Bulut lisans ve müşteri veritabanı</p>
            <span className={`${styles.status} ${status === 'ready' ? styles.ready : status === 'unavailable' ? styles.error : ''}`}>
              {statusLabel}
            </span>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.icon}><ShieldCheck size={22} /></div>
          <div>
            <h2>Yönetici Oturumu</h2>
            <p>HttpOnly oturum çerezleri ve e-posta MFA</p>
            <span className={`${styles.status} ${styles.ready}`}>Etkin</span>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.icon}><MailCheck size={22} /></div>
          <div>
            <h2>E-posta Doğrulaması</h2>
            <p>Tek kullanımlık yönetici giriş kodu</p>
            <span className={`${styles.status} ${styles.ready}`}>Etkin</span>
          </div>
        </section>
      </div>
    </div>
  );
}
