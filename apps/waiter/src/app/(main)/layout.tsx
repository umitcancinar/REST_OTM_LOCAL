'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Armchair, ClipboardList, Bell, LogOut, Sun, Moon } from 'lucide-react';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';

const NAV_ITEMS = [
  { href: '/tables', label: 'Masalar', icon: Armchair },
  { href: '/orders', label: 'Siparişler', icon: ClipboardList },
];

function WaiterLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();

  return (
    <div>
      {/* Theme Toggle — Fixed top right */}
      <button
        onClick={toggleTheme}
        style={{
          position: 'fixed',
          top: 12,
          right: 12,
          zIndex: 200,
          width: 36,
          height: 36,
          borderRadius: 10,
          border: '1.5px solid var(--border)',
          background: 'var(--bg-glass)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.15s',
          boxShadow: 'var(--shadow-sm)',
        }}
        title={theme === 'light' ? 'Karanlık Mod' : 'Aydınlık Mod'}
      >
        {theme === 'light' ? <Moon size={16} strokeWidth={2} /> : <Sun size={16} strokeWidth={2} />}
      </button>

      <main className="page-with-nav" style={{ minHeight: '100dvh', paddingTop: '16px', paddingLeft: '16px', paddingRight: '16px' }}>
        {children}
      </main>

      {/* Bottom Navigation */}
      <nav className="bottom-nav">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`bottom-nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">
                <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
        <Link href="/" className="bottom-nav-item" style={{ color: 'var(--danger)' }}>
          <span className="nav-icon">
            <LogOut size={20} strokeWidth={2} />
          </span>
          <span>Çıkış</span>
        </Link>
      </nav>
    </div>
  );
}

import { ToastProvider } from '@/components/ui/Toast';
import { NotificationProvider } from '@/context/NotificationContext';

export default function WaiterLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <NotificationProvider>
          <WaiterLayoutInner>{children}</WaiterLayoutInner>
        </NotificationProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
