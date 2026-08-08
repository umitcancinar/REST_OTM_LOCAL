'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  UtensilsCrossed,
  ClipboardList,
  BookOpen,
  Package2,
  BarChart2,
  Settings,
  Settings2,
  ChevronLeft,
  ChevronRight,
  Building2,
  Sparkles,
  PhoneCall,
  UsersRound,
  UserCheck,
  X,
  Globe,
  ChefHat,
} from 'lucide-react';
import styles from './Sidebar.module.css';
import { useLayout } from '@/context/LayoutContext';
import { useState, useEffect } from 'react';

const MENU_ITEMS = [
  { href: '/overview',   label: 'Genel Bakış',   icon: LayoutDashboard, roles: ['OWNER', 'ADMIN'] },
  { href: '/tables',     label: 'Masalar',        icon: UtensilsCrossed, roles: ['OWNER', 'ADMIN'] },
  { href: '/orders',     label: 'Siparişler',     icon: ClipboardList,   roles: ['OWNER', 'ADMIN', 'CASHIER'] },
  { href: '/menu',       label: 'Menü Yönetimi',  icon: BookOpen,        roles: ['OWNER', 'ADMIN'] },
  { href: '/takeaway',   label: 'Paket Siparişler',icon: PhoneCall,       roles: ['OWNER', 'ADMIN', 'CASHIER'], featureKey: 'takeaway' },
  { href: '/customers',  label: 'Müşteri Kayıtları',icon: UsersRound,      roles: ['OWNER', 'ADMIN'] },
  { href: '/inventory',  label: 'Stok Yönetimi',   icon: Package2,       roles: ['OWNER', 'ADMIN'] },
  { href: '/staff',      label: 'Personeller',     icon: UserCheck,      roles: ['OWNER', 'ADMIN'] },
  { href: '/reports',    label: 'Raporlar',        icon: BarChart2,       roles: ['OWNER', 'ADMIN'] },
  { href: '/settings',   label: 'Ayarlar',         icon: Settings,        roles: ['OWNER', 'ADMIN'] },
  { href: '/table-management', label: 'Masa Yönetimi', icon: Settings2,  roles: ['OWNER', 'ADMIN'] },
  { href: '/super-admin',label: 'Sistem Yönetimi', icon: Sparkles,        roles: ['SUPER_ADMIN'] },
] as const;

export default function Sidebar() {
  const pathname = usePathname();
  const { isCollapsed, toggleSidebar, isMobileMenuOpen, closeMobileMenu } = useLayout();
  const [user, setUser] = useState<any>(null);
  const [tenantFeatures, setTenantFeatures] = useState<Record<string, any>>({});

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }

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

  // SUPER_ADMIN'in impersonate ETMEDIGI surece bagli oldugu tek bir
  // isletme yok — o durumda badge hic gosterilmez (tenantBadgeName = null).
  const impersonatedTenantName = typeof window !== 'undefined' ? localStorage.getItem('impersonatedTenantName') : null;
  const isImpersonating = Boolean(impersonatedTenantName);
  const tenantBadgeName = isImpersonating
    ? impersonatedTenantName
    : user?.role === 'SUPER_ADMIN'
      ? null
      : (user?.tenant?.name || null);
  const tenantIsActive = isImpersonating ? true : user?.tenant?.isActive;

  const filteredItems = MENU_ITEMS.filter(item => {
    if (!user) return true;
    const roles = item.roles as readonly string[];
    if (!roles.includes(user.role)) return false;
    // If item has a featureKey and the tenant has that feature disabled, hide it
    if ('featureKey' in item && item.featureKey && tenantFeatures[item.featureKey] === false) return false;
    return true;
  });

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

      {/* Footer — Tenant Info.
          Bu kutu bir SUBE/musteri bilgisidir; SUPER_ADMIN'in kendine ait
          tek bir isletmesi olmadigi icin (impersonate etmedigi surece)
          gosterilmemeli. Isim de eskiden var olmayan `user.tenantName`
          alanindan okunuyordu (login yaniti nested `user.tenant.name`
          doner) — bu yuzden HER kullanicida sabit "TARİHİ ADANA
          KEBAPÇISI" metni goruluyordu, gercek restoran adindan bagimsiz. */}
      {tenantBadgeName && (
        <div className={styles.footer}>
          <div className={styles.tenantBadge} title={isCollapsed ? tenantBadgeName : ''}>
            <div className={styles.tenantAvatar}>
              <Building2 size={16} strokeWidth={2} />
            </div>
            {!isCollapsed && (
              <div className={styles.tenantInfo}>
                <p className={styles.tenantName}>{tenantBadgeName}</p>
                <p className={styles.tenantPlan} style={{ color: tenantIsActive === false ? 'var(--danger)' : 'var(--success)' }}>
                  {tenantIsActive === false ? 'Pasif' : 'Aktif'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
    </>
  );
}
