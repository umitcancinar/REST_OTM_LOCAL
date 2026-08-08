'use client';

import { useState, useMemo } from 'react';
import { 
  Bell, 
  Search, 
  ChevronRight,
  Sun,
  Moon,
  Info
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface MenuClientProps {
  tenantSlug: string;
  tableId?: string;
  menuData: any[]; // Kategori ve item listesi
  restaurantInfo: {
    name: string;
  };
}

export default function MenuClient({ tenantSlug, tableId, menuData, restaurantInfo }: MenuClientProps) {
  const { theme, toggleTheme } = useTheme();
  
  const [activeCategory, setActiveCategory] = useState<string>(menuData[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const displayToast = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const handleCallWaiter = async () => {
    if (!tableId) {
      displayToast('Masa numarası bulunamadı!');
      return;
    }
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/public/waiter/call/${tenantSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId })
      });
      displayToast('Garson çağrıldı!');
    } catch {
      displayToast('Bağlantı hatası.');
    }
  };


  const currentCategoryProducts = useMemo(() => {
    const term = searchQuery.toLowerCase();
    
    if (term) {
       // Search mode: show from all categories
       const allItems = menuData.flatMap(cat => cat.items || []);
       return allItems.filter(item => item.name.toLowerCase().includes(term) || item.description?.toLowerCase().includes(term));
    }
    
    const cat = menuData.find(c => c.id === activeCategory);
    return cat ? (cat.items || []) : [];
  }, [menuData, activeCategory, searchQuery]);

  return (
    <div style={{ paddingBottom: '90px' }} className="animate-fade-in">
      {/* Toast Notification */}
      {showToast && (
        <div style={{
          position: 'fixed',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--text-primary)',
          color: 'var(--bg-base)',
          padding: '12px 24px',
          borderRadius: 'var(--radius-full)',
          fontWeight: 600,
          fontSize: '0.875rem',
          zIndex: 9999,
          boxShadow: 'var(--shadow-lg)',
          animation: 'fadeIn 0.3s ease',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <Info size={16} />
          {toastMessage}
        </div>
      )}

      {/* Header */}
      <header style={{ 
        padding: '24px 20px 16px', 
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        position: 'sticky',
        top: 0,
        zIndex: 40,
        boxShadow: 'var(--shadow-sm)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              {restaurantInfo.name}
            </h1>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
              {tableId ? `Masa Özel QR Menü` : 'Göz Atma Modu'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              onClick={toggleTheme}
              style={{
                width: '36px', height: '36px',
                borderRadius: '50%',
                border: '1.5px solid var(--border)',
                background: 'var(--bg-elevated)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-secondary)'
              }}
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <button 
              onClick={handleCallWaiter}
              style={{
                width: '36px', height: '36px',
                borderRadius: '50%',
                border: 'none',
                background: 'var(--accent-muted)',
                color: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >
              <Bell size={18} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Ne yemek istersiniz?"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 16px 12px 42px',
              borderRadius: 'var(--radius-full)',
              border: '1.5px solid var(--border)',
              background: 'var(--bg-elevated)',
              fontSize: '0.9375rem',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-primary)',
              outline: 'none',
              transition: 'border-color 0.2s ease'
            }}
          />
        </div>
      </header>

      {/* Categories (Hide if searching) */}
      {!searchQuery && (
        <div style={{ 
          display: 'flex', 
          gap: '8px', 
          overflowX: 'auto', 
          padding: '16px 20px',
          background: 'var(--bg-base)',
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch'
        }}>
          {menuData.map(c => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              style={{
                padding: '10px 20px',
                borderRadius: 'var(--radius-full)',
                border: `1.5px solid ${activeCategory === c.id ? 'var(--accent)' : 'var(--border)'}`,
                background: activeCategory === c.id ? 'var(--accent-muted)' : 'var(--bg-surface)',
                color: activeCategory === c.id ? 'var(--accent)' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.875rem',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s ease'
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Product List */}
      <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: '16px', marginTop: searchQuery ? '16px' : '0' }}>
        {currentCategoryProducts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
            <Search size={40} strokeWidth={1} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
            <p>Ürün bulunamadı.</p>
          </div>
        ) : (
           currentCategoryProducts.map((item: any) => (
             <div 
               key={item.id} 
               style={{ 
                 display: 'flex', 
                 padding: '16px', 
                 background: 'var(--bg-surface)', 
                 borderRadius: 'var(--radius-xl)', 
                 boxShadow: 'var(--shadow-sm)',
                 border: '1px solid var(--border)',
                 gap: '16px'
               }}
             >
                <div style={{ 
                  width: '90px', 
                  height: '90px', 
                  borderRadius: 'var(--radius-md)', 
                  background: 'var(--bg-elevated)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: '2rem'
                }}>
                  🍽️
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                   <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>{item.name}</h3>
                   <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                     {item.description || 'İçerik detayı bulunmuyor.'}
                   </p>
                   <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px' }}>
                     <span style={{ fontSize: '1.125rem', fontWeight: 900, color: 'var(--accent)' }}>₺{item.basePrice.toLocaleString('tr-TR')}</span>
                   </div>
                </div>
             </div>
           ))
        )}
      </div>


    </div>
  );
}
