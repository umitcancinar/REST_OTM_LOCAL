'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList,
  Users,
  MapPin,
  CheckCircle2,
  XCircle,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { useNotifications } from '@/context/NotificationContext';
import Portal from '@/components/ui/Portal';

const STATUS_MAP: Record<string, { label: string; color: string; bg: string; border: string }> = {
  AVAILABLE: { label: 'Boş',     color: 'var(--success)',  bg: 'var(--success-bg)',  border: 'var(--success-border)' },
  OCCUPIED:  { label: 'Dolu',    color: 'var(--danger)',   bg: 'var(--danger-bg)',   border: 'var(--danger-border)' },
  RESERVED:  { label: 'Rezerve', color: 'var(--warning)',  bg: 'var(--warning-bg)',  border: 'var(--warning-border)' },
};

export default function TablesPage() {
  const toast = useToast();
  const router = useRouter();
  const [activeZone, setActiveZone] = useState('Tümü');
  const [tables, setTables] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [showResListModal, setShowResListModal] = useState(false);
  const [reservations, setReservations] = useState<any[]>([]);

  // Calculate dynamic zones from tables
  const existingZones = Array.from(new Set(tables.filter(t => !t.id.toString().startsWith('paket-')).map(t => (t.zone?.name || t.zone || '').toString().trim()))).filter(Boolean);
  const dynamicZones = ['Tümü', 'Açık Masalar', 'Paketler', ...existingZones];

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = showResListModal ? 'hidden' : 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [showResListModal]);

  const { socket } = useNotifications();

  const loadTables = useCallback(async () => {
    try {
      const [data, orders] = await Promise.all([
        api.get('/tables'),
        api.get('/orders')
      ]);

      const activeTakeaways = (orders || []).filter((o: any) =>
        o.type === 'TAKEAWAY' && !['COMPLETED', 'CANCELLED'].includes(o.status)
      );

      const fakeTakeaways = Array.from({ length: 10 }).map((_, i) => {
        const paketName = `Paket ${i + 1}`;
        const activeOrder = activeTakeaways.find((o: any) => o.customer?.name === paketName || o.customerName === paketName);
        return {
          id: `paket-${i + 1}`,
          number: paketName,
          zone: 'Paketler',
          status: activeOrder ? 'OCCUPIED' : 'AVAILABLE',
          capacity: 1,
          orders: activeOrder ? [activeOrder] : []
        };
      });

      const combined = [...data, ...fakeTakeaways];
      // Sort tables naturally
      combined.sort((a: any, b: any) => String(a.number).localeCompare(String(b.number), 'tr-TR', { numeric: true }));
      setTables(combined);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  useEffect(() => {
    if (!socket) return;

    const handleUpdate = () => {
      loadTables();
    };

    socket.on('table:status_changed', handleUpdate);
    socket.on('order:new', handleUpdate);
    socket.on('order:updated', handleUpdate);

    return () => {
      socket.off('table:status_changed', handleUpdate);
      socket.off('order:new', handleUpdate);
      socket.off('order:updated', handleUpdate);
    };
  }, [socket, loadTables]);

  const filtered = tables.filter(t => {
    if (activeZone === 'Tümü') return !t.id.toString().startsWith('paket-');
    if (activeZone === 'Açık Masalar') return t.status === 'OCCUPIED';
    if (activeZone === 'Paketler') return t.id.toString().startsWith('paket-');
    return (t.zone?.name || t.zone || '').toString().toLocaleUpperCase('tr-TR') === activeZone.toLocaleUpperCase('tr-TR');
  });

  const stats = {
    total: tables.filter(t => !t.id.toString().startsWith('paket-')).length,
    available: tables.filter(t => !t.id.toString().startsWith('paket-') && t.status === 'AVAILABLE').length,
    occupied: tables.filter(t => !t.id.toString().startsWith('paket-') && t.status === 'OCCUPIED').length,
    reserved: tables.filter(t => !t.id.toString().startsWith('paket-') && t.status === 'RESERVED').length,
  };

  const openReservations = async () => {
    try {
      const data = await api.get('/reservations');
      setReservations(data);
      setShowResListModal(true);
    } catch (e) {
      toast.error('Rezervasyonlar yüklenemedi');
    }
  };

  const handleUpdateResStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/reservations/${id}/status`, { status });
      toast.success('Durum güncellendi');
      const data = await api.get('/reservations');
      setReservations(data);
      loadTables();
    } catch (e) {
      toast.error('Durum güncellenemedi');
    }
  };

  return (
    <div className="animate-fade-in">
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Masalar</h1>
          <p className={styles.subtitle}>Toplam {stats.total} masa — {stats.available} boş, {stats.occupied} dolu, {stats.reserved} rezerve · Sipariş girmek için bir masaya tıklayın</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={openReservations}>
            <ClipboardList size={15} strokeWidth={2} />
            <span>Rezervasyonlar</span>
          </button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className={styles.quickStats}>
        {Object.entries(STATUS_MAP).map(([key, val]) => (
          <div key={key} className={styles.quickStat} style={{ borderLeft: `3px solid ${val.color}` }}>
            <span className={styles.quickStatValue}>
              {key === 'AVAILABLE' ? stats.available : key === 'OCCUPIED' ? stats.occupied : stats.reserved}
            </span>
            <span className={styles.quickStatLabel}>{val.label}</span>
          </div>
        ))}
      </div>

      {/* Zone Filters */}
      <div className={styles.zoneFilter} style={{ flexWrap: 'wrap' }}>
        {dynamicZones.map(z => (
          <button
            key={z}
            className={`${styles.zoneBtn} ${activeZone.toLocaleUpperCase('tr-TR') === z.toLocaleUpperCase('tr-TR') ? styles.zoneBtnActive : ''}`}
            onClick={() => setActiveZone(z)}
          >
            {z}
          </button>
        ))}
      </div>

      {/* Table Grid */}
      {isLoading ? (
        <div className={styles.tableGrid}>
          {Array(8).fill(0).map((_, i) => (
            <div key={i} className={styles.tableCard} style={{ opacity: 0.5, borderStyle: 'dashed' }}>
              <div className="skeleton" style={{ height: 32, width: '40%', marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 16, width: '80%', marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 16, width: '60%' }} />
              <div className="skeleton" style={{ marginTop: 24, height: 32, width: '100%' }} />
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.tableGrid}>
          {filtered.length === 0 && <p style={{ color: 'var(--text-tertiary)', padding: 16 }}>Bu bölümde kayıtlı masa bulunmuyor.</p>}
          {filtered.map(table => {
            const s = STATUS_MAP[table.status] || STATUS_MAP['AVAILABLE'];
            const activeOrder = table.orders?.find((o:any) => o.status === 'PREPARING' || o.status === 'PENDING' || o.status === 'READY');

            return (
              <div
                key={table.id}
                className={`${styles.tableCard} hover-pop`}
                style={{ borderColor: s.color, cursor: 'pointer' }}
                onClick={() => router.push(`/order/${table.id}`)}
              >
                <div className={styles.tableTop}>
                  <span className={styles.tableNumber}>{table.number}</span>
                  <span className={styles.tableBadge} style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
                    {s.label}
                  </span>
                </div>
                <div className={styles.tableInfo}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Users size={13} strokeWidth={2} /> {table.capacity} Kişilik
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MapPin size={13} strokeWidth={2} /> {typeof table.zone === 'string' ? table.zone : (table.zone?.name || 'Genel')}
                  </span>
                </div>
                {activeOrder && activeOrder.waiter && (
                  <div className={styles.tableWaiter}>
                    <span className={styles.waiterAvatar}>{activeOrder.waiter?.name?.charAt(0) || '?'}</span>
                    <span>{activeOrder.waiter?.name}</span>
                  </div>
                )}
                {activeOrder && activeOrder.grandTotal > 0 && (
                  <div className={styles.tableTotal}>₺{activeOrder.grandTotal.toLocaleString('tr-TR')}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Reservations Modal */}
      {showResListModal && (
        <Portal>
          <div className="modal-overlay" onClick={() => setShowResListModal(false)}>
            <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 800, width: '95%' }}>
              <div className="modal-header">
                <h3 className="modal-title">Rezervasyon Listesi</h3>
                <button onClick={() => setShowResListModal(false)} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
                  <X size={16} />
                </button>
              </div>

              <div className="modal-content-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Tarih / Saat</th>
                      <th>Müşteri Adı</th>
                      <th>Masa</th>
                      <th>Misafir Sayısı</th>
                      <th>Durum</th>
                      <th>İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reservations.length === 0 ? (
                      <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-tertiary)' }}>Rezervasyon bulunmamaktadır.</td></tr>
                    ) : reservations.map((res: any) => {
                      const date = new Date(res.reservationTime);
                      const isToday = date.toDateString() === new Date().toDateString();
                      const ds = isToday ? 'Bugün' : date.toLocaleDateString('tr-TR');
                      const ts = date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

                      return (
                        <tr key={res.id}>
                          <td><strong>{ds}</strong><br/><span style={{fontSize: '0.8rem', color: 'var(--text-tertiary)'}}>{ts}</span></td>
                          <td>{res.customerName}</td>
                          <td>{res.table?.number} ({res.table?.zone || 'Genel'})</td>
                          <td>{res.guestCount} Kişi</td>
                        <td>
                          <span className={`badge ${
                            res.status === 'COMPLETED' ? 'badge-success' :
                            res.status === 'CANCELLED' ? 'badge-danger' :
                            res.status === 'CONFIRMED' ? 'badge-info' : 'badge-warning'
                          }`}>
                            {res.status === 'COMPLETED' ? 'Geldi' :
                            res.status === 'CANCELLED' ? 'İptal' :
                            res.status === 'CONFIRMED' ? 'Onaylandı' : 'Bekliyor'}
                          </span>
                        </td>
                          <td>
                            {res.status === 'CONFIRMED' && (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => handleUpdateResStatus(res.id, 'COMPLETED')} className="btn btn-ghost btn-sm" style={{ color: 'var(--success)' }}>
                                  <CheckCircle2 size={13} /> Geldi
                                </button>
                                <button onClick={() => handleUpdateResStatus(res.id, 'CANCELLED')} className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}>
                                  <XCircle size={13} /> İptal
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <button className="btn btn-secondary" onClick={() => setShowResListModal(false)} style={{ minWidth: 120 }}>Kapat</button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
