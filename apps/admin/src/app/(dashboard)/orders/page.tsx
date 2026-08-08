'use client';

import { useState, useEffect } from 'react';
import {
  FileText,
  RefreshCcw,
  Clock,
  Utensils,
  ShoppingBag,
  Info,
  Download,
  Search,
  EyeOff,
  Calendar,
  X,
  Banknote,
  CreditCard,
  Landmark,
  Loader2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import styles from './page.module.css';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { useNotifications } from '@/context/NotificationContext';
import OrderDetailsModal from '@/components/OrderDetailsModal';
import Portal from '@/components/ui/Portal';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

type OrderStatus = 'UNPAID' | 'PAID' | 'CANCELLED';
import { PAYMENT_METHOD_OPTIONS as PAYMENT_METHODS, type PaymentMethod } from '@/lib/payments';

const STATUS_MAP: Record<string, { label: string; badge: string; color: string; bg: string }> = {
  PENDING:   { label: 'Bekliyor (Ödenmedi)', badge: 'badge-warning', color: '#B45309', bg: '#FEF3C7' },
  COMPLETED: { label: 'Ödendi (Tamamlandı)', badge: 'badge-success', color: '#15803D', bg: '#DCFCE7' },
  CANCELLED: { label: 'İptal Edildi',       badge: 'badge-danger',  color: '#B91C1C', bg: '#FEE2E2' },
  // Map intermediate & legacy statuses to simplified views
  UNPAID:    { label: 'Bekliyor', badge: 'badge-warning', color: '#B45309', bg: '#FEF3C7' },
  PAID:      { label: 'Ödendi',   badge: 'badge-success', color: '#15803D', bg: '#DCFCE7' },
  PREPARING: { label: 'Bekliyor', badge: 'badge-warning', color: '#B45309', bg: '#FEF3C7' },
  READY:     { label: 'Bekliyor', badge: 'badge-warning', color: '#B45309', bg: '#FEF3C7' },
  SERVED:    { label: 'Bekliyor', badge: 'badge-warning', color: '#B45309', bg: '#FEF3C7' },
  CONFIRMED: { label: 'Bekliyor', badge: 'badge-warning', color: '#B45309', bg: '#FEF3C7' },
};

const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'UNPAID', label: 'Ödenmeyenler' },
  { key: 'CANCELLED', label: 'İptal Edilenler' },
];

const OrderSkeleton = () => (
  <div style={{ 
    background: 'var(--bg-surface)', padding: 20, borderRadius: 'var(--radius-xl)', 
    border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16 
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <div style={{ flex: 1 }}>
        <div className="skeleton" style={{ height: 24, width: '60%', marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 16, width: '40%' }} />
      </div>
      <div className="skeleton" style={{ height: 24, width: 60, borderRadius: 12 }} />
    </div>
    <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px dashed var(--border)', display: 'flex', justifyContent: 'space-between' }}>
      <div className="skeleton" style={{ height: 28, width: 80 }} />
      <div className="skeleton" style={{ height: 32, width: 120, borderRadius: 8 }} />
    </div>
  </div>
);

export default function OrdersPage() {
  const toast = useToast();
  const [filter, setFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [timeFilter, setTimeFilter] = useState('TODAY');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [hiddenOrders, setHiddenOrders] = useState<string[]>([]);
  const [paymentOrder, setPaymentOrder] = useState<any>(null);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);

  useEffect(() => {
    // Load hidden orders from localStorage
    const saved = localStorage.getItem('hiddenOrders');
    if (saved) {
      try { setHiddenOrders(JSON.parse(saved)); } catch (e) {}
    }
  }, []);

  const handleHideOrder = async (orderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.patch(`/orders/${orderId}/hide`, {});
      toast.success('Sipariş gizlendi');
    } catch (error) {
      toast.error('Sipariş gizlenemedi');
    }
  };

  const [selectedOrder, setSelectedOrder] = useState<any>(null);

  const searchParams = useSearchParams();
  const globalQuery = searchParams.get('q');

  const { socket } = useNotifications();

  // Handle global search from Topbar
  useEffect(() => {
    if (globalQuery) {
      setSearchTerm(globalQuery);
    }
  }, [globalQuery]);

  const loadOrders = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await api.get('/orders?isDeleted=false');
      setOrders(data);
    } catch (err) {
      console.error(err);
      toast.error('Siparişler yüklenemedi.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (!socket) return;

    const handleUpdate = () => {
      loadOrders();
    };

    socket.on('order:new', handleUpdate);
    socket.on('order:updated', handleUpdate);
    socket.on('table:status_changed', handleUpdate);

    return () => {
      socket.off('order:new', handleUpdate);
      socket.off('order:updated', handleUpdate);
      socket.off('table:status_changed', handleUpdate);
    };
  }, [socket, loadOrders]);

  const persistOrderStatus = async (orderId: string, newStatus: string, paymentMethod?: PaymentMethod) => {
    setUpdatingOrderId(orderId);

    try {
      const updatedOrder = await api.patch(`/orders/${orderId}/status`, {
        status: newStatus,
        ...(paymentMethod ? { paymentMethod } : {}),
      });

      setOrders(prev => prev.map(order => order.id === orderId
        ? { ...order, ...updatedOrder, status: newStatus, paymentMethod: paymentMethod ?? null }
        : order));

      if (selectedOrder?.id === orderId) {
        setSelectedOrder((prev: any) => prev
          ? { ...prev, ...updatedOrder, status: newStatus, paymentMethod: paymentMethod ?? null }
          : prev);
      }

      setPaymentOrder(null);
      toast.success(newStatus === 'COMPLETED' ? 'Ödeme yöntemi kaydedildi' : 'Sipariş güncellendi');
    } catch (err) {
      toast.error('Güncelleme başarısız oldu.');
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const handleUpdateStatus = (order: any, newStatus: string, e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();

    if (newStatus === 'COMPLETED') {
      setPaymentOrder(order);
      return;
    }

    void persistOrderStatus(order.id, newStatus);
  };

  const handleExportExcel = () => {
     if (filtered.length === 0) return toast.warning('Dışa aktarılacak sipariş yok.');
     
     const exportData = filtered.map(o => ({
       'Sipariş No': o.orderNumber,
       'Tür': o.type === 'TAKEAWAY' ? 'Paket' : 'Masa Siparişi',
       'Masa / Müşteri': o.type === 'TAKEAWAY' ? o.customer?.name : o.table?.number,
       'Durum': STATUS_MAP[o.status as string]?.label || o.status,
       'Tutar': o.grandTotal,
       'Tarih': new Date(o.createdAt).toLocaleString('tr-TR')
     }));

     const ws = XLSX.utils.json_to_sheet(exportData);

     // Set column widths to prevent text from being cut off
     ws['!cols'] = [
       { wch: 15 }, // Sipariş No
       { wch: 15 }, // Tür
       { wch: 25 }, // Masa / Müşteri
       { wch: 25 }, // Durum
       { wch: 12 }, // Tutar
       { wch: 20 }, // Tarih
     ];

     const wb = XLSX.utils.book_new();
     XLSX.utils.book_append_sheet(wb, ws, "Siparisler");
     XLSX.writeFile(wb, `Siparisler_${timeFilter}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const filtered = orders.filter(o => {
     const orderDate = new Date(o.createdAt);
     const now = new Date();
     
     let matchTime = true;
     if (timeFilter === 'TODAY') {
       matchTime = orderDate.toDateString() === now.toDateString();
     } else if (timeFilter === 'WEEK') {
       const weekAgo = new Date();
       weekAgo.setDate(now.getDate() - 7);
       matchTime = orderDate >= weekAgo;
     } else if (timeFilter === 'MONTH') {
       const monthAgo = new Date();
       monthAgo.setDate(now.getDate() - 30);
       matchTime = orderDate >= monthAgo;
     } else if (timeFilter === 'YEAR') {
       const startOfYear = new Date(now.getFullYear(), 0, 1);
       matchTime = orderDate >= startOfYear;
     } else if (timeFilter === 'CUSTOM' && startDate && endDate) {
       const sDate = new Date(startDate);
       sDate.setHours(0, 0, 0, 0);
       const eDate = new Date(endDate);
       eDate.setHours(23, 59, 59, 999);
       matchTime = orderDate >= sDate && orderDate <= eDate;
     }

     // Hide both COMPLETED and CANCELLED from the active orders view. They will still appear in Reports.
     if (o.status === 'COMPLETED' || o.status === 'CANCELLED') return false;

     const matchStatus = filter === 'all' 
         ? true
         : filter === 'UNPAID' 
           ? (o.status !== 'CANCELLED')
           : o.status === filter;
     
     const matchType = typeFilter === 'all'
         ? true
         : typeFilter === 'TAKEAWAY' ? o.type === 'TAKEAWAY' : o.type !== 'TAKEAWAY';

     const matchSearch = searchTerm === '' 
         ? true 
         : o.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) || 
           (o.customer?.name && o.customer.name.toLocaleLowerCase('tr-TR').includes(searchTerm.toLocaleLowerCase('tr-TR'))) ||
           (o.table?.number && String(o.table.number).includes(searchTerm));

     return matchTime && matchStatus && matchType && matchSearch && !hiddenOrders.includes(o.id);
  });

  if (isLoading) {
    return (
      <div className="animate-fade-in" style={{ padding: '24px 24px' }}>
        <div className={styles.header} style={{ marginBottom: 40 }}>
           <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ height: 32, width: 240, marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 16, width: 140 }} />
           </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
          {[1,2,3,4,5,6].map(i => <OrderSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ padding: '0 24px 24px 24px' }}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <h1 className={styles.title}>Sipariş Yönetimi</h1>
          <p className={styles.subtitle}>Aktif sipariş takibi</p>
        </div>
        
        <div className={styles.headerActions}>
          <div className={styles.searchWrapper}>
             <Search size={16} className={styles.searchIcon} />
             <input 
               type="text" 
               placeholder="Sipariş, masa, veya müşteri ara..." 
               className={`input ${styles.searchInput}`} 
               value={searchTerm}
               onChange={e => setSearchTerm(e.target.value)}
             />
          </div>
          <div className={styles.actionButtons}>
            <button className="btn btn-ghost" onClick={handleExportExcel} title="Excel İndir">
               <Download size={16} /> <span className={styles.btnText}>Dışa Aktar</span>
            </button>
            <button className="btn btn-ghost" onClick={loadOrders} disabled={isRefreshing} title="Yenile">
               <RefreshCcw size={16} className={isRefreshing ? styles.spinning : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* Type Filter */}
      <div className={styles.typeFilters}>
         <button 
           onClick={() => setTypeFilter('all')}
           className={`${styles.typeBtn} ${typeFilter === 'all' ? styles.typeActive : ''}`}
         >
           Tümü
         </button>
         <button 
           onClick={() => setTypeFilter('DINING')}
           className={`${styles.typeBtn} ${typeFilter === 'DINING' ? styles.typeActive : ''}`}
         >
           <Utensils size={18} /> Masa Siparişleri
         </button>
         <button 
           onClick={() => setTypeFilter('TAKEAWAY')}
           className={`${styles.typeBtn} ${typeFilter === 'TAKEAWAY' ? styles.typeActive : ''}`}
         >
           <ShoppingBag size={18} /> Paket Siparişler
         </button>
      </div>

      <div className={styles.secondaryFilters}>
        <div className={styles.statusFilters}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`${styles.filterBtn} ${filter === f.key ? styles.filterActive : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className={styles.timeFilters}>
          {[
            { key: 'TODAY', label: 'Bugün' },
            { key: 'WEEK', label: 'Bu Hafta' },
            { key: 'MONTH', label: 'Bu Ay' },
            { key: 'YEAR', label: 'Bu Yıl' },
            { key: 'ALL', label: 'Tüm Zamanlar' }
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTimeFilter(t.key)}
              className={`${styles.timeBtn} ${timeFilter === t.key ? styles.timeActive : ''}`}
            >
              {t.label}
            </button>
          ))}
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px', marginLeft: 8 }}>
            <Calendar size={13} color="var(--text-tertiary)" />
            <input 
              type="date" 
              value={startDate} 
              onChange={e => { setStartDate(e.target.value); setTimeFilter('CUSTOM'); }}
              style={{ border: 'none', background: 'transparent', fontSize: '0.75rem', color: 'var(--text-primary)', outline: 'none', cursor: 'pointer' }} 
            />
            <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>–</span>
            <input 
              type="date" 
              value={endDate} 
              onChange={e => { setEndDate(e.target.value); setTimeFilter('CUSTOM'); }}
              style={{ border: 'none', background: 'transparent', fontSize: '0.75rem', color: 'var(--text-primary)', outline: 'none', cursor: 'pointer' }} 
            />
            {timeFilter === 'CUSTOM' && (
               <button 
                  onClick={() => { setTimeFilter('ALL'); setStartDate(''); setEndDate(''); }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', marginLeft: 4 }}
               >
                  <X size={14} />
               </button>
            )}
          </div>
        </div>
      </div>

      {/* Grid View */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
        {filtered.length === 0 && (
           <div style={{ padding: 40, textAlign: 'center', opacity: 0.5, gridColumn: '1 / -1' }}>
             <Info size={32} style={{ marginBottom: 12 }} />
             <p>Gösterilecek sipariş bulunmuyor.</p>
           </div>
        )}
        {filtered.map(order => {
           const s = STATUS_MAP[order.status] || { label: order.status, color: '#333', bg: '#f4f4f4' };
           const orderDate = new Date(order.createdAt).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
           const orderTime = new Date(order.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
           
           return (
             <div 
               key={order.id} 
               onClick={() => setSelectedOrder(order)}
               className="hover-pop"
               style={{ 
                 background: 'var(--bg-surface)', padding: 20, borderRadius: 'var(--radius-xl)', 
                 border: '1px solid var(--border)', cursor: 'pointer',
                 display: 'flex', flexDirection: 'column', gap: 16,
                 boxShadow: 'var(--shadow-sm)'
               }}
             >
               {/* Card Header */}
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 900, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                       {order.type === 'TAKEAWAY' ? <ShoppingBag size={18} color="var(--accent)" /> : <Utensils size={18} />}
                       {order.type === 'TAKEAWAY' ? `Paket: ${order.customer?.name}` : `Masa ${order.table?.number}`}
                    </h3>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                       <Clock size={12} /> {orderDate} {orderTime} • #{order.orderNumber}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ 
                      padding: '4px 10px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 800,
                      background: s.bg, color: s.color 
                    }}>
                       {s.label}
                    </span>
                    <button 
                      onClick={(e) => handleHideOrder(order.id, e)}
                      title="Siparişi Gizle"
                      style={{
                        padding: 6, borderRadius: 8, background: 'var(--bg-elevated)', 
                        border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-secondary)'
                      }}
                    >
                      <EyeOff size={14} />
                    </button>
                  </div>
               </div>

               {/* Money & Update Action */}
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 16, borderTop: '1px dashed var(--border)' }}>
                  <div style={{ fontSize: '1.375rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                     ₺{order.grandTotal}
                  </div>
                  <select 
                     className="input" 
                     value={order.status}
                     disabled={updatingOrderId === order.id}
                     style={{ padding: '4px 10px', fontSize: '0.8125rem', height: 32, fontWeight: 600, width: 'auto' }}
                     onClick={e => e.stopPropagation()}
                     onChange={e => handleUpdateStatus(order, e.target.value, e)}
                  >
                     <option value="PENDING">Bekliyor (Ödenmedi)</option>
                     <option value="COMPLETED">Ödendi (Tamamlandı)</option>
                     <option value="CANCELLED">İptal</option>
                  </select>
               </div>
             </div>
           );
        })}
      </div>

      {paymentOrder && (
        <Portal>
          <div
            onClick={() => !updatingOrderId && setPaymentOrder(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 200000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)' }}
          >
            <div
              className="card animate-scale-in"
              onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 460, padding: 32, position: 'relative' }}
            >
              {updatingOrderId === paymentOrder.id && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 2, borderRadius: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(3px)' }}>
                  <Loader2 className="animate-spin" size={36} color="var(--accent)" />
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                  <h3 style={{ fontSize: '1.5rem', fontWeight: 900, marginBottom: 4 }}>Ödeme Yöntemi</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Sipariş ödendi olarak kaydedilecek.</p>
                </div>
                <button
                  type="button"
                  aria-label="Ödeme penceresini kapat"
                  onClick={() => setPaymentOrder(null)}
                  style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--bg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-secondary)' }}
                >
                  <X size={18} />
                </button>
              </div>

              <div style={{ textAlign: 'center', marginBottom: 24, padding: 18, background: 'var(--bg-muted)', borderRadius: 16 }}>
                <p style={{ color: 'var(--text-tertiary)', fontSize: '0.8125rem', marginBottom: 6 }}>Tahsil Edilecek Tutar</p>
                <div style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--accent)' }}>
                  ₺{Number(paymentOrder.grandTotal).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                {PAYMENT_METHODS.map(method => {
                  const PaymentIcon = method.icon;
                  return (
                    <button
                      key={method.key}
                      type="button"
                      className="btn"
                      disabled={!!updatingOrderId}
                      onClick={() => void persistOrderStatus(paymentOrder.id, 'COMPLETED', method.key)}
                      style={{ minHeight: 104, padding: '12px 8px', flexDirection: 'column', gap: 9, fontSize: '0.78rem', fontWeight: 800, background: 'var(--bg-muted)', border: '2px solid var(--border)', borderRadius: 14, color: 'var(--text-primary)' }}
                    >
                      <PaymentIcon size={27} color={method.color} />
                      {method.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Portal>
      )}

      <OrderDetailsModal 
        isOpen={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        order={selectedOrder}
        onRefresh={() => {
           loadOrders();
           // Also re-fetch the specific selected order to update modal
           if (selectedOrder) {
              api.get(`/orders/${selectedOrder.id}`).then(res => {
                 setSelectedOrder(res);
              }).catch(() => setSelectedOrder(null));
           }
        }}
      />
    </div>
  );
}
