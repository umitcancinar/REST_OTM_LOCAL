'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './AdminTurnstile.module.css';

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: 'light';
      language: string;
      size: 'flexible';
      retry: 'auto';
      'refresh-expired': 'auto';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TEST_SITE_KEY = '1x00000000000000000000AA';
const ACTION = 'superadmin_login';

export function AdminTurnstile({
  onTokenChange,
  resetKey,
}: {
  onTokenChange: (token: string) => void;
  resetKey: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [widgetError, setWidgetError] = useState(false);
  const siteKey =
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
    (process.env.NODE_ENV === 'production' ? '' : TEST_SITE_KEY);

  const renderWidget = useCallback(() => {
    if (!siteKey || !containerRef.current || !window.turnstile || widgetIdRef.current) return;
    setWidgetError(false);
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action: ACTION,
      theme: 'light',
      language: 'tr',
      size: 'flexible',
      retry: 'auto',
      'refresh-expired': 'auto',
      callback: (token) => {
        setWidgetError(false);
        onTokenChange(token);
      },
      'expired-callback': () => onTokenChange(''),
      'error-callback': () => {
        onTokenChange('');
        setWidgetError(true);
      },
    });
  }, [onTokenChange, siteKey]);

  useEffect(() => {
    if (scriptReady) renderWidget();
  }, [renderWidget, scriptReady]);

  useEffect(() => {
    if (!resetKey || !widgetIdRef.current || !window.turnstile) return;
    onTokenChange('');
    window.turnstile.reset(widgetIdRef.current);
  }, [onTokenChange, resetKey]);

  useEffect(() => () => {
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    }
  }, []);

  if (!siteKey) {
    return (
      <p role="alert" className={styles.error}>
        Güvenlik doğrulaması yapılandırılmadı. Sistem yöneticisine başvurun.
      </p>
    );
  }

  return (
    <div className={styles.shell}>
      <Script
        id="cloudflare-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onLoad={() => setScriptReady(true)}
      />
      <div ref={containerRef} className={styles.widget} />
      {widgetError && (
        <p role="alert" className={styles.error}>
          Güvenlik kontrolü yüklenemedi. Sayfayı yenileyip tekrar deneyin.
        </p>
      )}
    </div>
  );
}
