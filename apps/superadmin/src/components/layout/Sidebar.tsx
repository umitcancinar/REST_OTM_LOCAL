'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Settings,
  ChevronLeft,
  ChevronRight,
  Building2,
  Sparkles,
  X,
  Globe,
  ChefHat,
  KeyRound,
} from 'lucide-react';
import styles from './Sidebar.module.css';
import { useLayout } from '@/context/LayoutContext';
import { useState, useEffect } from 'react';

const MENU_ITEMS = [
  { href: '/admin', label: 'Genel Bakış', icon: LayoutDashboard, roles: ['SUPER_ADMIN'] },
  { href: '/tenants', label: 'Restoranlar (Müşteriler)', icon: Building2, roles: ['SUPER_ADMIN'] },
  { href: '/licenses', label: 'Lisans Yönetimi', icon: KeyRound, roles: ['SUPER_ADMIN'] },
  { href: '/settings', label: 'Sistem Ayarları', icon: Settings, roles: ['SUPER_ADMIN'] },
] as const;

export default function Sidebar() {
  const pathname = usePathname();
  const { isCollapsed, toggleSidebar, isMobileMenuOpen, closeMobileMenu } = useLayout();
  const [user, setUser] = useState<{ role?: string; tenantName?: string } | null>(null);
  const [tenantFeatures, setTenantFeatures] = useState<Record<string, any>>({});
  const [impersonatedTenantName, setImpersonatedTenantName] = useState('');

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      try {
        const parsed: unknown = JSON.parse(userData);
        if (parsed && typeof parsed === 'object') {
          setUser(parsed as { role?: string; tenantName?: string });
        }
      } catch {}
    }

    setImpersonatedTenantName(localStorage.getItem('impersonatedTenantName') || '');

    // Load tenant features for sidebar filtering
    const impFeatures = localStorage.getItem('impersonatedFeatures');
    const tenantData = localStorage.getItem('tenantSettings');
    
    if (impFeatures) {
      try {
        setTenantFeatures(JSON.parse(impFeatures));
      } catch {}
    } else if (tenantData) {
      try {
        const parsed = JSON.parse(tenantData);
        const features = parsed.features || {};
        // Merge features and the rest of the settings into one object for easy access
        setTenantFeatures({ ...parsed, ...features });
      } catch {}
    }
  }, []);

  const filteredItems = MENU_ITEMS.filter(item => {
    if (!user) return true;
    const roles = item.roles as readonly string[];
    if (!user.role || !roles.includes(user.role)) return false;
    return true;
  });
  const footerName = impersonatedTenantName || user?.tenantName || 'REST_OTM Kontrol Merkezi';
  const footerStatus = user?.role === 'SUPER_ADMIN' ? 'Bulut Yönetimi · Aktif' : 'Pro Plan · Aktif';

  return (
    <>
      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div 
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 45, backdropFilter: 'blur(4px)' }} 
          onClick={closeMobileMenu}
        />
      )}
      
      <aside className={`${styles.sidebar} ${isCollapsed ? styles.collapsed : ''} ${isMobileMenuOpen ? styles.activeOnMobile : ''}`}>

      {/* Logo */}
      <div className={styles.logoSection}>
        <div className={styles.logoInfo}>
          <div className={styles.logoIconWrap}>
            <Sparkles size={18} strokeWidth={2} />
          </div>
          {!isCollapsed && (
            <div className={styles.logoTextGroup}>
              <span className={styles.logoText}>RESTOM</span>
              <span className={styles.logoTag}>Pro</span>
            </div>
          )}
        </div>
        <button
          className={styles.collapseBtn}
          onClick={toggleSidebar}
          title={isCollapsed ? 'Genişlet' : 'Küçült'}
          aria-label={isCollapsed ? 'Kenar çubuğunu genişlet' : 'Kenar çubuğunu küçült'}
        >
          {isCollapsed
            ? <ChevronRight size={15} strokeWidth={2.5} />
            : <ChevronLeft  size={15} strokeWidth={2.5} />
          }
        </button>

        {/* Mobile Close Button */}
        <button 
          className={styles.closeMobileBtn}
          onClick={closeMobileMenu}
          aria-label="Menüyü Kapat"
        >
          <X size={20} />
        </button>
      </div>

      {/* Scrollable Navigation Area */}
      <div className={styles.navContainer}>
        <nav className={styles.nav}>
          {!isCollapsed && (
            <span className={styles.navSection}>ANA MENÜ</span>
          )}
          {filteredItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                title={isCollapsed ? item.label : ''}
                onClick={closeMobileMenu}
              >
                {isActive && <span className={styles.activeBar} />}
                <span className={styles.itemIcon}>
                  <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                </span>
                {!isCollapsed && (
                  <span className={styles.itemLabel}>{item.label}</span>
                )}
                {isActive && !isCollapsed && (
                  <span className={styles.activeDot} />
                )}
              </Link>
            );
          })}
        </nav>

        {/* External Apps Navigation */}
        {(tenantFeatures.webSiteAdminUrl || tenantFeatures.kitchenPanelUrl) && (
          <nav className={styles.nav} style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)', marginLeft: 12, marginRight: 12 }}>
            {!isCollapsed && (
              <span className={styles.navSection} style={{ paddingLeft: 4, paddingRight: 4 }}>UYGULAMALAR</span>
            )}
            {tenantFeatures.webSiteAdminUrl && (
              <a
                href={tenantFeatures.webSiteAdminUrl as string}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.navItem}
                title={isCollapsed ? 'Web Sitesi Admin' : ''}
                onClick={closeMobileMenu}
              >
                <span className={styles.itemIcon}>
                  <Globe size={18} strokeWidth={2} />
                </span>
                {!isCollapsed && (
                  <span className={styles.itemLabel}>Web Sitesi</span>
                )}
              </a>
            )}
            {tenantFeatures.kitchenPanelUrl && (
              <a
                href={tenantFeatures.kitchenPanelUrl as string}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.navItem}
                title={isCollapsed ? 'Mutfak Paneli' : ''}
                onClick={closeMobileMenu}
              >
                <span className={styles.itemIcon}>
                  <ChefHat size={18} strokeWidth={2} />
                </span>
                {!isCollapsed && (
                  <span className={styles.itemLabel}>Mutfak Paneli</span>
                )}
              </a>
            )}
          </nav>
        )}
      </div>

      {/* Footer — Tenant Info */}
      <div className={styles.footer}>
        <div className={styles.tenantBadge} title={isCollapsed ? footerName : ''}>
          <div className={styles.tenantAvatar}>
            <Building2 size={16} strokeWidth={2} />
          </div>
          {!isCollapsed && (
            <div className={styles.tenantInfo}>
              <p className={styles.tenantName}>{footerName}</p>
              <p className={styles.tenantPlan}>{footerStatus}</p>
            </div>
          )}
        </div>
      </div>
    </aside>
    </>
  );
}
