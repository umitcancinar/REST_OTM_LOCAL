'use client';

import React from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useLayout } from '@/context/LayoutContext';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard,
  UtensilsCrossed,
  ClipboardList,
  BookOpen,
  BarChart2,
  PhoneCall,
  Settings,
} from 'lucide-react';

const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ['/overview', '/tables', '/table-management', '/orders', '/order', '/menu', '/takeaway', '/customers', '/inventory', '/staff', '/reports', '/settings', '/super-admin'],
  OWNER: ['/overview', '/tables', '/table-management', '/orders', '/order', '/menu', '/takeaway', '/customers', '/inventory', '/staff', '/reports', '/settings'],
  ADMIN: ['/overview', '/tables', '/table-management', '/orders', '/order', '/menu', '/takeaway', '/customers', '/inventory', '/staff', '/reports', '/settings'],
  CASHIER: ['/orders', '/order', '/takeaway'],
};

// Bottom nav items for mobile (pick the most important 5)
const BOTTOM_NAV = [
  { href: '/overview',  label: 'Genel',      icon: LayoutDashboard, roles: ['OWNER', 'ADMIN', 'SUPER_ADMIN'] },
  { href: '/tables',    label: 'Masalar',     icon: UtensilsCrossed, roles: ['OWNER', 'ADMIN', 'SUPER_ADMIN'] },
  { href: '/orders',    label: 'Siparişler',  icon: ClipboardList,   roles: ['OWNER', 'ADMIN', 'SUPER_ADMIN', 'CASHIER'] },
  { href: '/menu',      label: 'Menü',        icon: BookOpen,        roles: ['OWNER', 'ADMIN', 'SUPER_ADMIN'] },
  { href: '/reports',   label: 'Raporlar',    icon: BarChart2,       roles: ['OWNER', 'ADMIN', 'SUPER_ADMIN'] },
];

const BOTTOM_NAV_CASHIER = [
  { href: '/orders',   label: 'Siparişler', icon: ClipboardList, roles: ['CASHIER'] },
  { href: '/takeaway', label: 'Paket',      icon: PhoneCall,     roles: ['CASHIER'] },
  { href: '/settings', label: 'Ayarlar',    icon: Settings,      roles: ['CASHIER'] },
];

export default function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useLayout();
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [impersonatedName, setImpersonatedName] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>('');

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      router.push('/');
      return;
    }

    const user = JSON.parse(userData);
    if (user.sessionType === 'local_setup' && pathname !== '/staff') {
      router.replace('/staff');
      return;
    }
    const allowedRoutes = ROLE_PERMISSIONS[user.role] || [];
    setUserRole(user.role);

    // Check if current route is allowed
    const isAllowed = allowedRoutes.some(route => pathname.startsWith(route));

    if (!isAllowed) {
      if (user.role === 'WAITER') {
        localStorage.removeItem('user');
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        router.push('/');
        return;
      }
      if (user.role === 'CASHIER') {
        router.push('/orders');
      } else {
        router.push('/overview');
      }
    } else {
      setIsAuthorized(true);
    }

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

  const bottomNavItems = userRole === 'CASHIER' ? BOTTOM_NAV_CASHIER : BOTTOM_NAV;

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
      <main
        className={`main-content ${isCollapsed ? 'collapsed' : ''}`}
        style={impersonatedName ? { marginTop: '40px' } : {}}
      >
        <div className="page-container">
          {children}
        </div>
      </main>

      {/* ─── Mobile Bottom Navigation (≤1024px) ──────────────── */}
      <nav className="mobile-bottom-nav" role="navigation" aria-label="Ana Navigasyon">
        {bottomNavItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={isActive ? 'active' : ''}
              aria-current={isActive ? 'page' : undefined}
            >
              <span style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: '8px',
                background: isActive ? 'var(--accent-light)' : 'transparent',
                transition: 'all 0.15s ease',
              }}>
                <Icon
                  size={18}
                  strokeWidth={isActive ? 2.5 : 2}
                  color={isActive ? 'var(--accent)' : undefined}
                />
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
