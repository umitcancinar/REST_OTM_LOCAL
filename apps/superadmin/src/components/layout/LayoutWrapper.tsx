'use client';

import React from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useLayout } from '@/context/LayoutContext';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ['/overview', '/tables', '/orders', '/menu', '/takeaway', '/customers', '/inventory', '/staff', '/reports', '/settings', '/super-admin'],
  OWNER: ['/overview', '/tables', '/orders', '/menu', '/takeaway', '/customers', '/inventory', '/staff', '/reports', '/settings'],
  ADMIN: ['/overview', '/tables', '/orders', '/menu', '/takeaway', '/customers', '/inventory', '/staff', '/reports', '/settings'],
  CASHIER: ['/orders', '/takeaway'],
};

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useLayout();
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [impersonatedName, setImpersonatedName] = useState<string | null>(null);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      router.push('/');
      return;
    }

    const user = JSON.parse(userData);
    const allowedRoutes = ROLE_PERMISSIONS[user.role] || [];
    
    // Check if current route is allowed
    const isAllowed = allowedRoutes.some(route => pathname.startsWith(route));

    if (!isAllowed) {
      if (user.role === 'WAITER') {
        // Waiters shouldn't be here at all. Clear storage and kick out.
        localStorage.removeItem('user');
        router.push('/');
        return;
      }
      // Redirect to default page for role
      if (user.role === 'CASHIER') {
        router.push('/orders');
      } else {
        router.push('/overview');
      }
    } else {
      setIsAuthorized(true);
    }

    // Check impersonation
    const impId = localStorage.getItem('impersonatedTenantId');
    const impName = localStorage.getItem('impersonatedTenantName');
    if (impId) {
      setImpersonatedName(impName || impId);
    } else {
      setImpersonatedName(null);
    }
  }, [pathname, router]);

  if (!isAuthorized) return null;

  const exitImpersonation = () => {
    localStorage.removeItem('impersonatedTenantId');
    localStorage.removeItem('impersonatedTenantName');
    localStorage.removeItem('impersonatedFeatures');
    setImpersonatedName(null);
    window.location.href = '/super-admin';
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
