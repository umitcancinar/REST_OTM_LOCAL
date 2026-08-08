'use client';

import { useState } from 'react';
import { Mail, Lock, LogIn, Loader2, AlertCircle, Sparkles, User, Wallet } from 'lucide-react';
import styles from './page.module.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Giriş başarısız');
        return;
      }

      // Store tokens
      localStorage.setItem('accessToken', data.data.tokens.accessToken);
      localStorage.setItem('refreshToken', data.data.tokens.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.data.user));

      // Role-based redirect
      const user = data.data.user;
      
      if (user.role !== 'SUPER_ADMIN') {
        setError('Bu panele sadece Super Admin yetkisi ile girilebilir.');
        setIsLoading(false);
        return;
      }

      window.location.href = '/dashboard';


    } catch {
      setError('Sunucuya bağlanılamadı');
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

        {/* Form */}
        <form onSubmit={handleLogin} className={styles.form}>
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

          {error && (
            <div className={styles.errorMessage}>
              <AlertCircle size={15} strokeWidth={2} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className={styles.loginBtn}
            disabled={isLoading}
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
        </form>

        <p className={styles.version}>v 1.0.1 - Kolay ve Güvenli Yönetim</p>
      </div>
    </div>
  );
}
