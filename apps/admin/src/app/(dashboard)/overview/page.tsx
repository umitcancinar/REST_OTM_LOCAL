'use client';

import { useEffect, useState } from 'react';
import {
  TrendingUp,
  Clock3,
  CheckCircle2,
  Timer,
  CalendarPlus,
  ArrowUpRight,
  AlertTriangle,
  X,
  ChevronRight,
  Filter,
  Globe,
  ExternalLink,
  ChefHat,
} from 'lucide-react';
import Portal from '@/components/ui/Portal';
import OrderDetailsModal from '@/components/OrderDetailsModal';
import styles from './page.module.css';
import { api } from '@/lib/api';
import { formatBusinessDate } from '@/lib/dates';
import { useToast } from '@/components/ui/Toast';

export default function OverviewPage() {
  const toast = useToast();
  const [stats, setStats] = useState({
    dailyRevenue: 0,
    activeOrders: 0,
    completedOrders: 0,
  });
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [criticalInventory, setCriticalInventory] = useState<any[]>([]);
  const [availableTables, setAvailableTables] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Reservation Modal state
  const [showResModal, setShowResModal] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [resDateInput, setResDateInput] = useState(new Date().toISOString().split('T')[0]);
  const [resTime, setResTime] = useState('');
  
  // View All Orders Modal state
  const [showAllOrdersModal, setShowAllOrdersModal] = useState(false);
  const [orderTimeFilter, setOrderTimeFilter] = useState('all');
  const [allOrders, setAllOrders] = useState<any[]>([]);

  // Order Details Modal state
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<any>(null);

  async function loadDashboard() {
    try {
      // Gunu ACIKCA gonder: parametresiz cagride API, UTC gunune duser ve
      // Turkiye'de gece yarisindan sonra bir onceki gunu raporlar.
      const today = formatBusinessDate();
      const [dailyReport, allOrders, inventory, allTables] = await Promise.all([
        api.get(`/reports/daily?startDate=${today}&endDate=${today}`),
        api.get('/orders'),
        api.get('/inventory'),
        api.get('/tables'),
      ]);

      // Ciro ve "bugun tamamlanan" DAIMA /reports/daily'den gelir: o uc nokta
      // tarih araligini sunucuda uygular. Daha once bu cagri yapilip sonucu
      // kullanilmiyor, sayilar `/orders` (TUM zamanlar) uzerinden hesaplaniyordu;
      // gunluk ciro her gecen gun buyuyup hic sifirlanmiyordu.
      // "Aktif siparisler" ise bilerek tarihten bagimsiz: dun acilip henuz
      // kapanmamis bir masa bugun de ekranda gorunmeli.
      const active = allOrders.filter((o: any) => o.status === 'PREPARING' || o.status === 'READY' || o.status === 'PENDING');

      setStats({
        dailyRevenue: dailyReport?.totalRevenue || 0,
        activeOrders: active.length,
        completedOrders: dailyReport?.totalOrders || 0,
      });

      setRecentOrders(allOrders.slice(0, 5));
      setAllOrders(allOrders);
      
      const critical = inventory.filter((i: any) => i.currentStock <= i.minStockAlert).slice(0, 5);
      setCriticalInventory(critical);

      setAvailableTables(allTables);
    } catch (err) {
      console.error('Genel bakış yüklenemedi', err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const handleCreateReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTableId) {
      toast.warning('Lütfen bir masa seçin');
      return;
    }
    try {
       const [h, m] = resTime.split(':');
       const finalDate = new Date(resDateInput);
       finalDate.setHours(Number(h), Number(m), 0, 0);

       await api.post('/reservations', {
         tableId: selectedTableId,
         customerName,
         reservationTime: finalDate.toISOString(),
       });
       toast.success(`${customerName} adına ${resDateInput} ${resTime} saati için rezervasyon oluşturuldu.`);
       setShowResModal(false);
       setCustomerName('');
       setResTime('');
       setSelectedTableId('');
       setIsLoading(true);
       await loadDashboard();
    } catch (err) {
       toast.error('Rezervasyon oluşturulamadı.');
    }
  };

  const STAT_CARDS = [
    {
      label: 'Günlük Ciro',
      value: `₺${stats.dailyRevenue.toLocaleString('tr-TR')}`,
      icon: TrendingUp,
      color: 'var(--success)',
      bg: 'var(--success-bg)',
      border: 'var(--success-border)',
    },
    {
      label: 'Aktif Siparişler',
      value: stats.activeOrders,
      icon: Clock3,
      color: 'var(--warning)',
      bg: 'var(--warning-bg)',
      border: 'var(--warning-border)',
    },
    {
      label: 'Tamamlanan (Bugün)',
      value: stats.completedOrders,
      icon: CheckCircle2,
      color: 'var(--accent)',
      bg: 'var(--accent-light)',
      border: 'var(--border-focus)',
    },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING': return { class: 'badge-warning', label: 'Bekliyor' };
      case 'COMPLETED': return { class: 'badge-success', label: 'Ödendi' };
      case 'CANCELLED': return { class: 'badge-danger', label: 'İptal' };
      default: return { class: 'badge-warning', label: 'Bekliyor' };
    }
  };

  const getFilteredOrders = () => {
    const now = new Date();
    const startOfToday = new Date(now.setHours(0,0,0,0));
    
    return allOrders.filter(o => {
      const date = new Date(o.createdAt);
      if (orderTimeFilter === 'today') return date >= startOfToday;
      if (orderTimeFilter === 'week') {
        const lastWeek = new Date(now.setDate(now.getDate() - 7));
        return date >= lastWeek;
      }
      if (orderTimeFilter === 'month') {
        const lastMonth = new Date(now.setMonth(now.getMonth() - 1));
        return date >= lastMonth;
      }
      return true;
    });
  };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Genel Bakış</h1>
          <p className={styles.subtitle}>İşletmenizin bugünkü özeti</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowResModal(true)} id="new-reservation-btn">
          <CalendarPlus size={16} strokeWidth={2} />
          <span>Yeni Rezervasyon</span>
        </button>
      </div>

      {/* Stats Grid */}
      <div className={`${styles.statsGrid} stagger-children`}>
        {STAT_CARDS.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="card">
              <div
                className={styles.statIconWrapper}
                style={{
                  color: stat.color,
                  background: stat.bg,
                  border: `1px solid ${stat.border}`,
                }}
              >
                <Icon size={20} strokeWidth={2} />
              </div>
              <p className={styles.statLabel}>{stat.label}</p>
              {isLoading ? (
                <div className="skeleton" style={{ height: 32, width: 120, marginTop: 8 }} />
              ) : (
                <div className={styles.statRow}>
                  <h3 className={styles.statValue}>{stat.value}</h3>
                </div>
              )}
            </div>
          );
        })}
      </div>



      {/* Split Layout — Orders + Alerts */}
      <div className={styles.splitLayout}>
        {/* Recent Orders */}
        <div className="card" style={{ flex: 2 }}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Son Siparişler</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAllOrdersModal(true)}>
              <span>Tümünü Gör</span>
              <ChevronRight size={14} strokeWidth={2} />
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Sipariş No</th>
                <th>Masa</th>
                <th>Tutar</th>
                <th>Durum</th>
                <th>Saat</th>
              </tr>
            </thead>
            <tbody>
               {isLoading ? (
                Array(4).fill(0).map((_, i) => (
                  <tr key={i}>
                    <td><div className="skeleton" style={{ height: 18, width: 80 }} /></td>
                    <td><div className="skeleton" style={{ height: 18, width: 56 }} /></td>
                    <td><div className="skeleton" style={{ height: 18, width: 64 }} /></td>
                    <td><div className="skeleton" style={{ height: 24, width: 88, borderRadius: 12 }} /></td>
                    <td><div className="skeleton" style={{ height: 18, width: 48 }} /></td>
                  </tr>
                ))
               ) : recentOrders.length === 0 ? (
                 <tr>
                   <td colSpan={5} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-tertiary)' }}>
                     Henüz sipariş yok
                   </td>
                 </tr>
               ) : (
                recentOrders.map(order => {
                  const orderTime = new Date(order.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
                  const badge = getStatusBadge(order.status);
                  return (
                    <tr 
                      key={order.id}
                      onClick={() => setSelectedOrderDetails(order)}
                      style={{ cursor: 'pointer' }}
                      onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--bg-elevated)'}
                      onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                        #{order.orderNumber}
                      </td>
                      <td>Masa {order.table?.number || 'Paket'}</td>
                      <td style={{ fontWeight: 600 }}>₺{order.grandTotal.toLocaleString('tr-TR')}</td>
                      <td>
                        <span className={`badge ${badge.class}`}>{badge.label}</span>
                      </td>
                      <td style={{ color: 'var(--text-tertiary)' }}>{orderTime}</td>
                    </tr>
                  );
                })
               )}
            </tbody>
          </table>
        </div>

        {/* Stock Alerts */}
        <div className="card" style={{ flex: 1 }}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Stok Uyarıları</h3>
          </div>
          <div className={styles.alertList}>
            {isLoading ? (
              Array(3).fill(0).map((_, i) => (
                <div key={i} className={styles.alertItem}>
                  <div className="skeleton" style={{ height: 40, width: 40, borderRadius: 10 }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                     <div className="skeleton" style={{ height: 14, width: '80%' }} />
                     <div className="skeleton" style={{ height: 12, width: '50%' }} />
                  </div>
                </div>
              ))
            ) : criticalInventory.length === 0 ? (
               <div className={styles.emptyState}>
                 <CheckCircle2 size={28} strokeWidth={1.5} style={{ color: 'var(--success)', marginBottom: 8 }} />
                 <p>Kritik stok uyarısı yok.</p>
               </div>
            ) : (
              criticalInventory.map(item => (
                <div key={item.id} className={styles.alertItem}>
                  <div className={styles.alertIcon}>
                    <AlertTriangle size={16} strokeWidth={2} />
                  </div>
                  <div className={styles.alertContent}>
                    <p className={styles.alertTitle}>{item.name} tükenmek üzere</p>
                    <p className={styles.alertDesc}>
                      Kalan: {item.currentStock} {item.unit === 'PIECE' ? 'adet' : 'kg'} (Limit: {item.minStockAlert})
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Reservation Modal */}
      {showResModal && (
        <Portal>
          <div className="modal-overlay" onClick={() => setShowResModal(false)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setShowResModal(false)}>
                <X size={18} />
              </button>
              <div className="modal-header">
                <h3 className="modal-title">Yeni Rezervasyon</h3>
              </div>
              <form onSubmit={handleCreateReservation} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div className="input-group">
                  <label>Müşteri Adı - Soyadı</label>
                  <input required autoFocus type="text" className="input" value={customerName} onChange={e => setCustomerName(e.target.value)} id="res-customer-name" />
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Tarih</label>
                    <input 
                      required 
                      type="date" 
                      className="input" 
                      value={resDateInput} 
                      min={new Date().toISOString().split('T')[0]}
                      onChange={e => setResDateInput(e.target.value)} 
                      id="res-date"
                    />
                  </div>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Saat</label>
                    <input required type="time" className="input" value={resTime} onChange={e => setResTime(e.target.value)} id="res-time" />
                  </div>
                </div>
                <div className="input-group">
                  <label>Masa Seç</label>
                  <select required className="input" value={selectedTableId} onChange={e => setSelectedTableId(e.target.value)} id="res-table-select">
                    <option value="">Lütfen seçiniz</option>
                    {availableTables.map((t: any) => (
                      <option key={t.id} value={t.id}>{t.number} — {t.capacity} Kişilik ({t.zone || 'Genel'})</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                  <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowResModal(false)}>İptal</button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }} id="res-submit">
                    <CalendarPlus size={15} strokeWidth={2} />
                    <span>Rezerve Et</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </Portal>
      )}

      {/* All Orders Modal */}
      {showAllOrdersModal && (
        <Portal>
          <div className="modal-overlay" onClick={() => setShowAllOrdersModal(false)}>
            <div className="modal-box" style={{ maxWidth: 900, width: '95%' }} onClick={e => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setShowAllOrdersModal(false)}>
                <X size={18} />
              </button>
              
              <div className="modal-header" style={{ marginBottom: 24 }}>
                <h3 className="modal-title">Tüm Siparişler</h3>
              </div>

              {/* Time Filters */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 24, overflowX: 'auto', paddingBottom: 4 }}>
                {[
                  { id: 'today', label: 'Bugün' },
                  { id: 'week', label: 'Bu Hafta' },
                  { id: 'month', label: 'Bu Ay' },
                  { id: 'all', label: 'Tüm Zamanlar' }
                ].map(f => (
                  <button 
                    key={f.id}
                    className={`btn ${orderTimeFilter === f.id ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ whiteSpace: 'nowrap' }}
                    onClick={() => setOrderTimeFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="modal-content-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Sipariş No</th>
                      <th>Masa</th>
                      <th>Tutar</th>
                      <th>Durum</th>
                      <th>Tarih / Saat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getFilteredOrders().length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                          Bu periyotta sipariş bulunmuyor.
                        </td>
                      </tr>
                    ) : (
                      getFilteredOrders().map(order => {
                        const date = new Date(order.createdAt);
                        const dateStr = date.toLocaleDateString('tr-TR');
                        const timeStr = date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
                        const badge = getStatusBadge(order.status);
                        return (
                          <tr 
                            key={order.id}
                            onClick={() => setSelectedOrderDetails(order)}
                            style={{ cursor: 'pointer' }}
                            onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--bg-elevated)'}
                            onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <td style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>#{order.orderNumber}</td>
                            <td>Masa {order.table?.number || 'Paket'}</td>
                            <td style={{ fontWeight: 700 }}>₺{order.grandTotal.toLocaleString('tr-TR')}</td>
                            <td><span className={`badge ${badge.class}`}>{badge.label}</span></td>
                            <td>
                              <div style={{ fontSize: '0.8125rem' }}>{dateStr}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{timeStr}</div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" style={{ minWidth: 120 }} onClick={() => setShowAllOrdersModal(false)}>Kapat</button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* Order Details Modal */}
      {selectedOrderDetails && (
        <OrderDetailsModal
          isOpen={!!selectedOrderDetails}
          order={selectedOrderDetails}
          onClose={() => setSelectedOrderDetails(null)}
          onRefresh={loadDashboard}
        />
      )}

    </div>
  );
}
