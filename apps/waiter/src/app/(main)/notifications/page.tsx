'use client';

import { useState } from 'react';
import { Bell, User, Receipt, CheckCheck, Clock } from 'lucide-react';

const NOTIFICATIONS = [
  { id: '1', type: 'ready', title: 'Sipariş Hazır', message: 'Masa 3 siparişi mutfaktan çıktı.', time: '2 dk önce', read: false },
  { id: '2', type: 'call', title: 'Garson Çağrısı', message: 'Masa 14 garson çağırıyor.', time: '5 dk önce', read: false },
  { id: '3', type: 'bill', title: 'Hesap İsteği', message: 'Masa 8 hesap istiyor.', time: '12 dk önce', read: true },
  { id: '4', type: 'ready', title: 'Sipariş Hazır', message: 'Masa 10 siparişi mutfaktan çıktı.', time: '1 saat önce', read: true },
];

export default function NotificationsPage() {
  const [notifs, setNotifs] = useState(NOTIFICATIONS);

  const markAllRead = () => {
    setNotifs(notifs.map(n => ({ ...n, read: true })));
  };

  const getIconData = (type: string) => {
    if (type === 'ready') return { icon: Bell, color: 'var(--success)' };
    if (type === 'call') return { icon: User, color: 'var(--warning)' };
    if (type === 'bill') return { icon: Receipt, color: 'var(--accent)' };
    return { icon: Bell, color: 'var(--text-primary)' };
  };

  return (
    <div className="page-container animate-fade-in" style={{ padding: '24px 16px 100px' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.04em' }}>Bildirimler</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', fontWeight: 500, marginTop: '2px' }}>Restoran aktivite akışı</p>
        </div>
        {notifs.some(n => !n.read) && (
          <button 
            onClick={markAllRead} 
            style={{ 
              background: 'var(--accent-muted)', border: 'none', color: 'var(--accent)', 
              padding: '8px 14px', borderRadius: 'var(--radius-md)',
              fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px'
            }}
          >
            <CheckCheck size={14} /> Tümünü Okundu Say
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
         {notifs.map(n => {
            const { icon: Icon, color } = getIconData(n.type);
            return (
              <div key={n.id} style={{ 
                 display: 'flex', gap: '16px', padding: '18px', borderRadius: 'var(--radius-lg)',
                 background: n.read ? 'var(--bg-surface)' : 'var(--bg-elevated)',
                 border: '1.5px solid var(--border)',
                 position: 'relative', overflow: 'hidden',
                 transition: 'all 0.2s',
                 boxShadow: n.read ? 'none' : 'var(--shadow-sm)'
              }}>
                 {!n.read && (
                    <div style={{ 
                       position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px', background: color
                    }} />
                 )}
                 
                 <div style={{ 
                    width: '52px', height: '52px', borderRadius: 'var(--radius-md)', 
                    background: `${color}15`, color: color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 
                 }}>
                    <Icon size={24} strokeWidth={2.5} />
                 </div>

                 <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                       <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.9375rem' }}>{n.title}</span>
                       <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)', fontSize: '0.6875rem', fontWeight: 700 }}>
                          <Clock size={12} /> {n.time}
                       </div>
                    </div>
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5, fontWeight: 500 }}>
                       {n.message}
                    </p>
                 </div>
              </div>
            );
         })}
      </div>

      {notifs.length === 0 && (
        <div style={{ textAlign: 'center', padding: '80px 24px', opacity: 0.4 }}>
           <Bell size={48} strokeWidth={1} style={{ margin: '0 auto 16px' }} />
           <p style={{ fontWeight: 600 }}>Henüz bildiriminiz bulunmuyor.</p>
        </div>
      )}
    </div>
  );
}
