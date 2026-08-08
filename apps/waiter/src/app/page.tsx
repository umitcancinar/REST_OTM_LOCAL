'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, LogIn, Loader2, Sparkles, ChefHat } from 'lucide-react';

export default function WaiterLoginPage() {
  const router = useRouter();
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

      localStorage.setItem('accessToken', data.data.tokens.accessToken);
      localStorage.setItem('refreshToken', data.data.tokens.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.data.user));

      router.push('/tables');
    } catch {
      setError('Sunucu bağlantı hatası');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      minHeight: '100dvh',
      padding: '24px',
      background: 'var(--bg-base)'
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        padding: '32px 24px',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-md)',
        border: '1px solid var(--border)',
        width: '100%',
        maxWidth: '400px',
        margin: '0 auto'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--gradient-accent)',
            color: 'white',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '16px',
            boxShadow: 'var(--shadow-glow)'
          }}>
            <Sparkles size={32} strokeWidth={2} />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>
            Garson Paneli
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Hızlı sipariş yönetimi
          </p>
        </div>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              E-posta
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Mail size={18} strokeWidth={2} style={{ position: 'absolute', left: '14px', color: 'var(--text-muted)' }} />
              <input
                type="email"
                placeholder="ornek@restoran.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="input"
                style={{ paddingLeft: '44px' }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Şifre
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Lock size={18} strokeWidth={2} style={{ position: 'absolute', left: '14px', color: 'var(--text-muted)' }} />
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="input"
                style={{ paddingLeft: '44px' }}
              />
            </div>
          </div>

          {error && (
            <div style={{
              background: 'var(--danger-bg)',
              color: 'var(--danger)',
              padding: '12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8125rem',
              fontWeight: 500,
              border: '1px solid var(--danger-border)'
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="waiter-btn waiter-btn-primary"
            disabled={isLoading}
            style={{ marginTop: '8px' }}
          >
            {isLoading ? <Loader2 size={20} className="animate-spin" /> : (
              <>
                <LogIn size={18} strokeWidth={2} />
                Giriş Yap
              </>
            )}
          </button>
        </form>

      </div>
    </div>
  );
}
