'use client';

import React from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useLayout } from '@/context/LayoutContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useLayout();
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [impersonatedName, setImpersonatedName] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setIsAuthorized(false);

    async function validateServerSession() {
      try {
        // Authentication is authoritative on the BFF. localStorage is never an
        // access-control boundary and only receives harmless display metadata.
        const response = await fetch('/api/backend/auth/profile', {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('unauthorized');
        const payload = await response.json();
        const user = payload?.data;
        if (!user || user.role !== 'SUPER_ADMIN') throw new Error('forbidden');

        localStorage.setItem('user', JSON.stringify(user));

        const impId = localStorage.getItem('impersonatedTenantId');
        const impName = localStorage.getItem('impersonatedTenantName');
        setImpersonatedName(impId ? impName || impId : null);
        setIsAuthorized(true);
      } catch {
        if (controller.signal.aborted) return;
        localStorage.removeItem('user');
        localStorage.removeItem('impersonatedTenantId');
        localStorage.removeItem('impersonatedTenantName');
        localStorage.removeItem('impersonatedFeatures');
        router.replace('/login');
      }
    }

    void validateServerSession();
    return () => controller.abort();
  }, [router]);

  if (!isAuthorized) return null;

  const exitImpersonation = () => {
    localStorage.removeItem('impersonatedTenantId');
    localStorage.removeItem('impersonatedTenantName');
    localStorage.removeItem('impersonatedFeatures');
    setImpersonatedName(null);
    window.location.href = '/admin';
  };

  return (
    <div className="dashboard-layout">
      {impersonatedName && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: 'linear-gradient(90deg, #dc2626, #b91c1c)',
          color: '#fff', padding: '8px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px',
          fontSize: '0.875rem', fontWeight: 600,
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
        }}>
          <span>⚠️ Şu an <strong>{impersonatedName}</strong> hesabındasınız (Impersonation modu)</span>
          <button
            onClick={exitImpersonation}
            style={{
              background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)',
              color: '#fff', padding: '4px 16px', borderRadius: '6px',
              cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600
            }}
          >
            Çıkış Yap
          </button>
        </div>
      )}
      <Sidebar />
      <Topbar />
      <main className={`main-content ${isCollapsed ? 'collapsed' : ''}`} style={impersonatedName ? { marginTop: '40px' } : {}}>
        <div className="page-container">
          {children}
        </div>
      </main>
    </div>
  );
}
