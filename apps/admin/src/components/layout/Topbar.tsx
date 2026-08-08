'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Bell, LogOut, User, CheckCheck, Menu as MenuIcon } from 'lucide-react';
import styles from './Topbar.module.css';
import { useLayout } from '@/context/LayoutContext';
import ThemeToggle from '@/components/ui/ThemeToggle';
import { useNotifications } from '@/context/NotificationContext';

export default function Topbar() {
  const router = useRouter();
  const { isCollapsed, toggleMobileMenu } = useLayout();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [searchTerm, setSearchTerm] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);
  const [currentUser, setCurrentUser] = useState<{ name: string; role: string } | null>(null);

  // Load current user from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const parsed = JSON.parse(stored);
        const roleLabels: Record<string, string> = {
          SUPER_ADMIN: 'Super Admin',
          OWNER: 'Patron (Sahip)',
          CHEF: 'Şef',
          CASHIER: 'Kasiyer',
          WAITER: 'Garson',
        };
        setCurrentUser({
          name: parsed.name || 'Kullanıcı',
          role: roleLabels[parsed.role] || parsed.role || 'Bilinmiyor',
        });
      }
    } catch {
      // localStorage not available or JSON parse error
    }
  }, []);

  // Close notifications on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && searchTerm.trim()) {
      router.push(`/orders?q=${encodeURIComponent(searchTerm)}`);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    localStorage.removeItem('impersonatedTenantId');
    localStorage.removeItem('impersonatedTenantName');
    router.push('/');
  };

  return (
    <header className={`${styles.topbar} ${isCollapsed ? styles.collapsed : ''}`}>
      <div className={styles.searchSection}>
        <button 
          className={styles.mobileMenuBtn} 
          onClick={toggleMobileMenu}
          aria-label="Menüyü aç"
        >
          <MenuIcon size={20} />
        </button>

        <div className={styles.searchBox}>
          <Search size={15} strokeWidth={2} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Sipariş no, müşteri veya menü ara..."
            className={styles.searchInput}
            id="global-search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleSearch}
          />
          <div className={styles.shortcutKey}>
            <kbd>⌘</kbd><kbd>K</kbd>
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        <ThemeToggle />

        {/* ─── BİLDİRİMLER ───────────────────────── */}
        <div style={{ position: 'relative' }} ref={notificationRef}>
          <button 
            className={styles.iconBtn} 
            title="Bildirimler" 
            id="notifications-btn"
            onClick={() => setShowNotifications(!showNotifications)}
          >
            <Bell size={18} strokeWidth={2} />
            {unreadCount > 0 && <span className={styles.badge}>{unreadCount > 9 ? '9+' : unreadCount}</span>}
          </button>

          {showNotifications && (
            <div className={styles.notificationDropdown}>
              <div className={styles.notificationHeader}>
                <h3 className={styles.notificationTitle}>Bildirimler</h3>
                {unreadCount > 0 && (
                  <button onClick={markAllAsRead} className={styles.markAllReadBtn}>
                    <CheckCheck size={14} /> Tümünü Oku
                  </button>
                )}
              </div>
              <div className={styles.notificationList}>
                {notifications.length === 0 ? (
                  <div className={styles.emptyNotifications}>
                    Yeni bildiriminiz yok.
                  </div>
                ) : (
                  notifications.map(n => (
                    <div 
                      key={n.id} 
                      className={`${styles.notificationItem} ${!n.read ? styles.unread : ''}`}
                      onClick={() => markAsRead(n.id)}
                    >
                      <div className={`${styles.statusDot} ${n.read ? '' : (n.type === 'waiter' ? styles.waiterDot : styles.infoDot)}`} />
                      <div style={{ flex: 1 }}>
                        <p className={styles.notifTitle}>
                          {n.title}
                        </p>
                        <p className={styles.notifMessage}>{n.message}</p>
                        <p className={styles.notifTime}>
                          {new Date(n.time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className={styles.separator} />

        <div className={styles.profileDropdown}>
          <div className={styles.avatar}>
            <User size={16} strokeWidth={2} />
          </div>
          <div className={styles.userInfo}>
            <p className={styles.userName}>{currentUser?.name || 'Kullanıcı'}</p>
            <p className={styles.userRole}>{currentUser?.role || '...'}</p>
          </div>
          
          <button
            onClick={handleLogout}
            className={styles.logoutBtn}
            title="Çıkış Yap"
            id="logout-btn"
          >
            <LogOut size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
    </header>
  );
}
