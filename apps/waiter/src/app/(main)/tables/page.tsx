'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, MapPin, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useNotifications } from '@/context/NotificationContext';
import styles from './TablesPage.module.css';


export default function TablesPage() {
  const router = useRouter();
  const [activeZone, setActiveZone] = useState('Tümü');
  const [searchQuery, setSearchQuery] = useState('');
  const [tables, setTables] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const { socket } = useNotifications();

  const fetchTables = useCallback(async () => {
    try {
      const [tablesData, ordersData] = await Promise.all([
        api.get('/tables'),
        api.get('/orders')
      ]);

      // Active takeaway orders mapped by customerName
      const activeTakeaways = (ordersData || []).filter((o: any) => 
        o.type === 'TAKEAWAY' && !['COMPLETED', 'CANCELLED'].includes(o.status)
      );

      const fakeTakeaways = Array.from({ length: 10 }).map((_, i) => {
        const paketName = `Paket ${i + 1}`;
        const activeOrder = activeTakeaways.find((o: any) => o.customer?.name === paketName || o.customerName === paketName);
        
        return {
          id: `paket-${i + 1}`,
          number: paketName,
          zone: 'Paket Siparişler',
          status: activeOrder ? 'OCCUPIED' : 'AVAILABLE',
          capacity: 1,
          orders: activeOrder ? [activeOrder] : []
        };
      });

      setTables([...tablesData, ...fakeTakeaways]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  useEffect(() => {
    if (!socket) return;

    const handleUpdate = () => {
      console.log('Real-time update received: Refreshing tables...');
      fetchTables();
    };

    socket.on('table:status_changed', handleUpdate);
    socket.on('order:new', handleUpdate);
    socket.on('order:updated', handleUpdate);

    return () => {
      socket.off('table:status_changed', handleUpdate);
      socket.off('order:new', handleUpdate);
      socket.off('order:updated', handleUpdate);
    };
  }, [socket, fetchTables]);

  const filtered = tables.filter(t => {
    const tableZone = t.zone?.name || t.zone || 'Genel';
    const matchesZone = activeZone === 'Tümü' || tableZone === activeZone;
    const matchesSearch = String(t.number).toLowerCase().includes(searchQuery.toLowerCase());
    return matchesZone && matchesSearch;
  });

  const dynamicZones = ['Tümü', ...Array.from(new Set(tables.map(t => t.zone?.name || t.zone || 'Genel')))];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Masalar</h1>
        <p className={styles.subtitle}>
          Şu anda toplam {tables.length} aktif masa bulunuyor.
        </p>
      </div>

      {/* Search Input */}
      <div className={styles.searchContainer}>
        <Search size={20} strokeWidth={2.5} className={styles.searchIcon} />
        <input
          type="text"
          placeholder="Masa numarası ara..."
          className={`input ${styles.searchInput}`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Zone Filters */}
      <div className={styles.filterScroll}>
        {dynamicZones.map(z => (
          <button
            key={z}
            onClick={() => setActiveZone(z)}
            className={`${styles.filterBtn} ${activeZone === z ? styles.filterBtnActive : ''}`}
          >
            {z}
          </button>
        ))}
      </div>

      {/* Table Grid */}
      <div className={styles.grid}>
        {isLoading ? (
          Array(8).fill(0).map((_, i) => (
            <div key={i} style={{ height: '140px', borderRadius: 'var(--radius-xl)', background: 'var(--bg-elevated)' }} className="animate-pulse" />
          ))
        ) : filtered.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '60px 24px', color: 'var(--text-tertiary)', fontWeight: 600 }}>
            Seçilen kriterlere uygun masa bulunamadı.
          </div>
        ) : (
          filtered.map(table => {
            const isAvailable = table.status === 'AVAILABLE';
            const isOccupied = table.status === 'OCCUPIED';
            const statusClass = isAvailable ? 'available' : isOccupied ? 'occupied' : 'reserved';
            const statusLabel = isAvailable ? 'BOŞ' : isOccupied ? 'DOLU' : 'REZERVE';
            
            const activeOrder = table.orders?.find((o:any) => o.status === 'PREPARING' || o.status === 'PENDING' || o.status === 'READY');

            return (
              <div
                key={table.id}
                className={`table-card ${statusClass}`}
                onClick={() => router.push(`/order/${table.id}`)}
              >
                <div className="table-number">{table.number}</div>
                <div className="table-status">{statusLabel}</div>
                
                <div className={styles.cardExtraInfo}>
                  <div className={styles.infoItem}>
                    <Users size={14} /> {table.capacity}
                  </div>
                  <div className={styles.infoItem}>
                    <MapPin size={14} /> {table.zone?.name || table.zone || 'Genel'}
                  </div>
                </div>

                {activeOrder && (
                  <div className={styles.orderBadge}>
                    ₺{activeOrder.grandTotal?.toLocaleString('tr-TR')}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
