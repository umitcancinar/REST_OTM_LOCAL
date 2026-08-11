'use client';

import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Mail, Lock, LogIn, Loader2, AlertCircle, Sparkles, MailCheck, ShieldCheck } from 'lucide-react';
import { AdminTurnstile } from '@/components/auth/AdminTurnstile';
import styles from './page.module.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [emailHint, setEmailHint] = useState('');
  const [stage, setStage] = useState<'credentials' | 'verification'>('credentials');
  const [verificationPhase, setVerificationPhase] = useState<'idle' | 'orbiting' | 'verified'>('idle');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, turnstileToken }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Giriş başarısız');
        setTurnstileResetKey((value) => value + 1);
        return;
      }

      if (!data.requiresVerification) throw new Error('E-posta doğrulaması başlatılamadı.');
      setEmailHint(data.emailHint || email);
      setPassword('');
      setStage('verification');


    } catch {
      setError('Sunucuya bağlanılamadı');
      setTurnstileResetKey((value) => value + 1);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setVerificationPhase('orbiting');
    try {
      const [res] = await Promise.all([
        fetch('/api/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: verificationCode }) }),
        new Promise((resolve) => window.setTimeout(resolve, 1250)),
      ]);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Kod doğrulanamadı.');
      setVerificationPhase('verified');
      await new Promise((resolve) => window.setTimeout(resolve, 850));
      window.location.href = '/admin';
    } catch (err) {
      setVerificationPhase('idle');
      setError(err instanceof Error ? err.message : 'Doğrulama yapılamadı.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      {/* Animated Background */}
      <div className={styles.bgWrap}>
        <div className={styles.bgGradient1} />
        <div className={styles.bgGradient2} />
        <div className={styles.bgGradient3} />
        <div className={styles.bgGrid} />
      </div>

      <div className={styles.card}>
        {/* Logo */}
        <div className={styles.logoSection}>
          <div className={styles.logoIcon}>
            <Sparkles size={24} strokeWidth={2} />
          </div>
          <h1 className={styles.logoTitle}>REST_OTM</h1>
          <p className={styles.logoSubtitle}>SuperAdmin Paneli</p>
        </div>

        {stage === 'credentials' ? <form onSubmit={handleLogin} className={styles.form}>
          <div className={styles.inputGroup}>
            <label htmlFor="email">E-posta Adresi</label>
            <div className={styles.inputWrapper}>
              <Mail size={16} strokeWidth={2} className={styles.inputIcon} />
              <input
                id="email"
                type="email"
                placeholder="ornek@restoran.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={styles.input}
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="password">Şifre</label>
            <div className={styles.inputWrapper}>
              <Lock size={16} strokeWidth={2} className={styles.inputIcon} />
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={styles.input}
                required
                autoComplete="current-password"
              />
            </div>
          </div>

          <AdminTurnstile
            onTokenChange={setTurnstileToken}
            resetKey={turnstileResetKey}
          />

          {error && (
            <div className={styles.errorMessage}>
              <AlertCircle size={15} strokeWidth={2} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className={styles.loginBtn}
            disabled={isLoading || !turnstileToken}
            id="login-submit"
          >
            {isLoading ? (
              <Loader2 size={18} strokeWidth={2} className={styles.spinner} />
            ) : (
              <>
                <LogIn size={16} strokeWidth={2} />
                <span>Giriş Yap</span>
              </>
            )}
          </button>
        </form> : <form onSubmit={handleVerification} className={styles.form}>
          <div className={styles.verificationIcon}><MailCheck size={26} strokeWidth={2} /></div>
          <div className={styles.verificationCopy}><h2>E-postanı doğrula</h2><p><strong>{emailHint}</strong> adresine 6 haneli, tek kullanımlık bir erişim kodu gönderdik.</p></div>
          <div className={styles.inputGroup}>
            <label htmlFor="verification-code">Doğrulama kodu</label>
            <OtpOrbitInput value={verificationCode} onChange={setVerificationCode} phase={verificationPhase} />
          </div>
          {error && <div className={styles.errorMessage}><AlertCircle size={15} strokeWidth={2} /><span>{error}</span></div>}
          <button type="submit" className={styles.loginBtn} disabled={isLoading || verificationCode.length !== 6}>{verificationPhase === 'verified' ? <><ShieldCheck size={16} /><span>Doğrulandı</span></> : isLoading ? <Loader2 size={18} strokeWidth={2} className={styles.spinner} /> : <><ShieldCheck size={16} /><span>Doğrula ve giriş yap</span></>}</button>
          <button type="button" className={styles.backButton} onClick={() => { setStage('credentials'); setVerificationCode(''); setError(''); }}>Farklı hesapla giriş yap</button>
        </form>}

        <p className={styles.version}>v 1.0.1 - Kolay ve Güvenli Yönetim</p>
      </div>
    </div>
  );
}

function OtpOrbitInput({ value, onChange, phase }: { value: string; onChange: (value: string) => void; phase: 'idle' | 'orbiting' | 'verified' }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? '');

  function update(index: number, raw: string) {
    const next = [...digits];
    next[index] = raw.replace(/\D/g, '').slice(-1);
    onChange(next.join(''));
    if (next[index] && index < 5) refs.current[index + 1]?.focus();
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) refs.current[index - 1]?.focus();
    if (event.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
    if (event.key === 'ArrowRight' && index < 5) refs.current[index + 1]?.focus();
  }

  return <div className={`${styles.otpOrbitStage} ${phase === 'orbiting' ? styles.otpOrbiting : ''} ${phase === 'verified' ? styles.otpVerified : ''}`} onPaste={(event) => { const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6); if (!pasted) return; event.preventDefault(); onChange(pasted); refs.current[Math.min(pasted.length, 6) - 1]?.focus(); }}>
    <div className={styles.otpRing} aria-hidden />
    <div className={styles.otpRow} role="group" aria-label="6 haneli doğrulama kodu">
      {digits.map((digit, index) => <input key={index} ref={(node) => { refs.current[index] = node; }} aria-label={`${index + 1}. hane`} autoComplete={index === 0 ? 'one-time-code' : 'off'} className={styles.otpSlot} disabled={phase !== 'idle'} inputMode="numeric" maxLength={1} onChange={(event) => update(index, event.target.value)} onKeyDown={(event) => onKeyDown(index, event)} pattern="[0-9]" required style={{ '--otp-x': `${(index - 2.5) * 52}px`, '--otp-delay': `${index * 35}ms` } as CSSProperties} value={digit} />)}
    </div>
    <div className={styles.otpVerifiedTile} aria-hidden><ShieldCheck size={24} strokeWidth={2.8} /></div>
  </div>;
}
