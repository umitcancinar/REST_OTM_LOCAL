'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import OrderItemModal from '@/components/OrderItemModal';
import OrderDetailsModal from '@/components/OrderDetailsModal';
import { api } from '@/lib/api';
import { PAYMENT_LABELS } from '@/lib/payments';
import { useToast } from '@/components/ui/Toast';
import { useNotifications } from '@/context/NotificationContext';
import { 
  CheckCircle2, 
  Clock, 
  Plus,
  Loader2,
  Utensils,
  CheckCheck,
  ShoppingBag,
  X,
  CreditCard,
  Banknote
} from 'lucide-react';

const STATUS_MAP: Record<string, { label: string; badge: string; color: string; bg: string }> = {
  PENDING:   { label: 'Bekliyor', badge: 'badge-warning', color: '#B45309', bg: '#FEF3C7' },
  COMPLETED: { label: 'Ödendi',   badge: 'badge-success', color: '#15803D', bg: '#DCFCE7' },
  CANCELLED: { label: 'İptal',    badge: 'badge-danger',  color: '#B91C1C', bg: '#FEE2E2' },
  CONFIRMED: { label: 'Bekliyor', badge: 'badge-warning', color: '#B45309', bg: '#FEF3C7' },
  PREPARING: { label: 'Bekliyor', badge: 'badge-warning', color: '#B45309', bg: '#FEF3C7' },
  READY:     { label: 'Bekliyor', badge: 'badge-warning', color: '#B45309', bg: '#FEF3C7' },
  SERVED:    { label: 'Bekliyor', badge: 'badge-warning', color: '#B45309', bg: '#FEF3C7' },
  DELIVERED: { label: 'Bekliyor', badge: 'badge-warning', color: '#B45309', bg: '#FEF3C7' },
  pending:   { label: 'Bekliyor', badge: 'badge-warning', color: '#B45309', bg: '#FEF3C7' },
  served:    { label: 'Bekliyor', badge: 'badge-warning', color: '#B45309', bg: '#FEF3C7' },
};

const fmt = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const TODAY = new Date().toISOString().split('T')[0]!;
const WEEK_AGO = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]!;
const MONTH_AGO = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]!;
const CURRENT_YEAR_START = `${new Date().getFullYear()}-01-01`;

const PRESETS = [
  { label: 'Bugün',     start: TODAY,     end: TODAY },
  { label: 'Bu Hafta',  start: WEEK_AGO,  end: TODAY },
  { label: 'Bu Ay',     start: MONTH_AGO, end: TODAY },
  { label: 'Bu Yıl',    start: CURRENT_YEAR_START, end: TODAY },
];

export default function WaiterOrdersPage() {
  const router = useRouter();
  const toast = useToast();
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [showPastOrdersModal, setShowPastOrdersModal] = useState(false);
  const [activePreset, setActivePreset] = useState('Bugün');
  const [startDate, setStartDate] = useState(TODAY);
  const [endDate, setEndDate] = useState(TODAY);
  const [selectedPastOrder, setSelectedPastOrder] = useState<any | null>(null);

  const { socket } = useNotifications();

  const loadOrders = useCallback(async () => {
    try {
      const data = await api.get('/orders?isDeleted=false');
      setOrders(data);
    } catch (err) {
      toast.error('Siparişler yüklenirken bir hata oluştu.');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (!socket) return;
    const handleUpdate = () => { loadOrders(); };
    socket.on('order:new', handleUpdate);
    socket.on('order:updated', handleUpdate);
    socket.on('table:status_changed', handleUpdate);
    return () => {
      socket.off('order:new', handleUpdate);
      socket.off('order:updated', handleUpdate);
      socket.off('table:status_changed', handleUpdate);
    };
  }, [socket, loadOrders]);

  useEffect(() => {
    if (showPastOrdersModal) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [showPastOrdersModal]);

  const handleMarkDelivered = async (orderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isUpdating === orderId) return;
    setIsUpdating(orderId);
    try {
      await api.patch(`/orders/${orderId}/status`, { status: 'DELIVERED' });
      toast.success('Sipariş teslim edildi olarak işaretlendi.');
      await loadOrders();
    } catch (err) {
      toast.error('Teslim edildi olarak işaretlenemedi.');
    } finally {
      setIsUpdating(null);
    }
  };

  const handleAddMore = (order: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (order.type === 'TAKEAWAY') {
      const paketNo = order.customerName?.split(' ')[1] || '1';
      router.push(`/order/paket-${paketNo}`);
      return;
    }
    if (!order.tableId) return;
    router.push(`/order/${order.tableId}`);
  };

  const activeOrders = orders.filter(o => !o.isDeleted && o.status !== 'COMPLETED' && o.status !== 'DELIVERED' && o.status !== 'CANCELLED');
  
  // For modal
  const startD = new Date(startDate); startD.setHours(0,0,0,0);
  const endD = new Date(endDate); endD.setHours(23,59,59,999);
  
  const pastOrders = orders.filter(o => {
    if (o.isDeleted || (o.status !== 'COMPLETED' && o.status !== 'DELIVERED' && o.status !== 'CANCELLED')) return false;
    const d = new Date(o.createdAt);
    return d >= startD && d <= endD;
  });
  
  // Sort past orders by latest first
  pastOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="animate-fade-in" style={{ 
      height: 'calc(100dvh - 16px - 81px)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* HEADER SECTION */}
      <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', paddingRight: '48px' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Siparişlerim
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '4px' }}>
            Takip ettiğiniz masaların siparişleri
          </p>
        </div>
        <button 
          className="btn btn-ghost hover-pop" 
          onClick={() => setShowPastOrdersModal(true)}
          style={{ fontSize: '0.875rem', fontWeight: 700, padding: '8px 16px', borderRadius: '20px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        >
          Geçmiş Siparişler
        </button>
      </div>

      {/* CONTENT SECTION: Scrollable (Only active orders) */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '40px' }}>
        {isLoading ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
             <Loader2 className="animate-spin" size={24} style={{ margin: '0 auto' }} color="var(--accent)" />
          </div>
        ) : activeOrders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-tertiary)', background: 'var(--bg-surface)', borderRadius: 'var(--radius-xl)', border: '1.5px dashed var(--border)' }}>
            <Utensils size={48} strokeWidth={1} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
            <p style={{ fontWeight: 600 }}>Aktif sipariş bulunmamaktadır.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', paddingRight: '4px' }}>
            {activeOrders.map(order => {
              const items = order.subChecks?.flatMap((sc: any) => sc.items) || [];
              const pendingItemsCount = items.filter((i: any) => i.status === 'PENDING').length;
              const preparingItemsCount = items.filter((i: any) => i.status === 'PREPARING').length;
              const readyItemsCount = items.filter((i: any) => i.status === 'READY').length;

              return (
                <div 
                  key={order.id} 
                  className="hover-pop" 
                  style={{ 
                    background: 'var(--bg-surface)', padding: 20, borderRadius: 'var(--radius-xl)', 
                    border: '1px solid var(--border)', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', gap: 16,
                    boxShadow: 'var(--shadow-sm)'
                  }}
                  onClick={(e) => handleAddMore(order, e)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h3 style={{ fontSize: '1.25rem', fontWeight: 900, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-primary)' }}>
                        {order.type === 'TAKEAWAY' ? <ShoppingBag size={18} color="var(--accent)" /> : <Utensils size={18} />}
                        {order.type === 'TAKEAWAY' ? `Paket: ${order.customerName || order.customer?.name || 'Paket Sipariş'}` : `Masa ${order.table?.number || '-'}`}
                      </h3>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} /> 
                        {new Date(order.createdAt).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date(order.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} • #{order.orderNumber}
                      </div>
                    </div>
                  </div>

                  {/* Summary Badges */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {pendingItemsCount > 0 && <span className="badge badge-warning" style={{ fontSize: '10px' }}>{pendingItemsCount} Bekliyor</span>}
                    {preparingItemsCount > 0 && <span className="badge badge-info" style={{ fontSize: '10px' }}>{preparingItemsCount} Hazırlanıyor</span>}
                    {readyItemsCount > 0 && <span className="badge badge-success" style={{ fontSize: '10px' }}>{readyItemsCount} Hazır</span>}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {items.slice(0, 3).map((item: any) => (
                      <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{item.quantity}x {item.menuItemName}</span>
                        {item.status === 'READY' && <CheckCheck size={14} color="#10B981" />}
                      </div>
                    ))}
                    {items.length > 3 && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600, marginTop: '4px' }}>
                        + {items.length - 3} ürün daha
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 16, borderTop: '1px dashed var(--border)' }}>
                    <div style={{ fontSize: '1.375rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                      ₺{order.grandTotal.toLocaleString('tr-TR')}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {readyItemsCount > 0 && (
                        <button 
                          className="btn btn-primary"
                          style={{ padding: '8px 16px', background: 'var(--success)', border: 'none', fontSize: '0.8125rem' }}
                          onClick={(e) => { e.stopPropagation(); handleMarkDelivered(order.id, e); }}
                          disabled={isUpdating === order.id}
                        >
                          {isUpdating === order.id ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} style={{ marginRight: '6px' }} />}
                          Teslim Et
                        </button>
                      )}
                      <button 
                        className="btn btn-ghost"
                        style={{ padding: '8px 16px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', fontSize: '0.8125rem' }}
                        onClick={(e) => { e.stopPropagation(); handleAddMore(order.tableId, e); }}
                      >
                        <Plus size={16} style={{ marginRight: '6px' }} />
                        Ekle
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* PAST ORDERS MODAL */}
      {mounted && showPastOrdersModal && createPortal(
        <div 
          className="modal-overlay" 
          onClick={() => setShowPastOrdersModal(false)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backgroundColor: 'rgba(15, 23, 42, 0.65)' }}
        >
          <div 
            className="modal-box" 
            style={{ 
              maxWidth: 640, width: '100%', padding: 0, maxHeight: '85vh', display: 'flex', flexDirection: 'column', 
              borderRadius: 24, background: 'var(--bg-surface)', boxShadow: '0 30px 60px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)',
              overflow: 'hidden', animation: 'scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' 
            }} 
            onClick={e => e.stopPropagation()}
          >
            {/* Header Area */}
            <div style={{ position: 'relative', padding: '32px 32px 24px', background: 'linear-gradient(to bottom, var(--bg-elevated), var(--bg-surface))', borderBottom: '1px solid var(--border)' }}>
              <button 
                onClick={() => setShowPastOrdersModal(false)}
                style={{ position: 'absolute', top: 24, right: 24, width: 36, height: 36, borderRadius: '50%', background: 'var(--bg-body)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.2s' }}
                onMouseOver={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                onMouseOut={e => e.currentTarget.style.background = 'var(--bg-body)'}
              >
                <X size={18} />
              </button>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                <div style={{ width: 48, height: 48, borderRadius: 16, background: 'linear-gradient(135deg, var(--accent), #818CF8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 8px 16px rgba(99,102,241,0.25)' }}>
                  <ShoppingBag size={24} />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 2 }}>Geçmiş Siparişler</h2>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Seçili tarih aralığındaki siparişleriniz</p>
                </div>
              </div>

              {/* Filters */}
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
                {PRESETS.map(preset => {
                  const isActive = activePreset === preset.label;
                  return (
                    <button
                      key={preset.label}
                      onClick={() => {
                        setActivePreset(preset.label);
                        setStartDate(preset.start);
                        setEndDate(preset.end);
                      }}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 12,
                        fontSize: '0.8125rem',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        background: isActive ? 'var(--accent)' : 'var(--bg-elevated)',
                        color: isActive ? '#fff' : 'var(--text-secondary)',
                        border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                        cursor: 'pointer',
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                        boxShadow: isActive ? '0 4px 12px rgba(99,102,241,0.3)' : 'none',
                        transform: isActive ? 'translateY(-1px)' : 'none'
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>
            
            {/* Scrollable list */}
            <div className="modal-content-scroll" style={{ padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', flex: 1 }}>
              {pastOrders.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center', background: 'var(--bg-elevated)', borderRadius: 20, border: '1px dashed var(--border)' }}>
                  <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--bg-body)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, color: 'var(--text-tertiary)' }}>
                    <ShoppingBag size={32} />
                  </div>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>Sipariş Bulunamadı</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', maxWidth: 280 }}>Seçilen tarih aralığında gösterilecek herhangi bir geçmiş sipariş kaydı yok.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {pastOrders.map(o => {
                    const isCompleted = o.status === 'COMPLETED';
                    const isCancelled = o.status === 'CANCELLED';
                    const statusColor = isCompleted ? '#10B981' : (isCancelled ? '#EF4444' : '#64748B');
                    const statusBg = isCompleted ? '#D1FAE5' : (isCancelled ? '#FEE2E2' : '#F1F5F9');
                    
                    return (
                      <div 
                        key={o.id} 
                        style={{ 
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                          padding: '20px 24px', transition: 'all 0.2s',
                          border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                          borderRadius: 16, position: 'relative', overflow: 'hidden',
                          cursor: 'pointer'
                        }}
                        onClick={() => router.push(`/orders/${o.id}`)}
                        onMouseOver={e => {
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.boxShadow = '0 12px 24px -10px rgba(0,0,0,0.1)';
                        }}
                        onMouseOut={e => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      >
                        {/* Status Left Accent */}
                        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: statusColor }} />
                        
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                            <div style={{ fontWeight: 800, fontSize: '1.0625rem', color: 'var(--text-primary)' }}>
                              {o.type === 'TAKEAWAY' ? o.customerName || 'Paket Sipariş' : `Masa ${o.table?.number || '-'}`}
                            </div>
                            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: statusColor, background: statusBg, padding: '4px 10px', borderRadius: 20 }}>
                              {isCompleted ? 'Ödendi' : (isCancelled ? 'İptal Edildi' : 'Bilinmeyen')}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
                            <span style={{ background: 'var(--bg-body)', padding: '2px 6px', borderRadius: 6, border: '1px solid var(--border)' }}>#{o.orderNumber}</span>
                            <span>•</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={12} /> {new Date(o.createdAt).toLocaleString('tr-TR')}</span>
                          </div>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 900, color: 'var(--text-primary)', fontSize: '1.25rem', marginBottom: 6, letterSpacing: '-0.02em' }}>
                            ₺{fmt(o.grandTotal)}
                          </div>
                          {isCompleted && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                              {/* Yontem NAKIT/KART ile sinirli degil: IBAN, Yemek Sepeti,
                                  Trendyol Go, Getir de secilebiliyor. Ikili kontrol bunlarin
                                  hepsini "Nakit" gosterip odeme yanlis kaydedilmis izlenimi
                                  veriyordu. */}
                              {o.paymentMethod === 'CASH' ? <Banknote size={14} /> : <CreditCard size={14} />}
                              {PAYMENT_LABELS[o.paymentMethod] || 'Nakit'}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
