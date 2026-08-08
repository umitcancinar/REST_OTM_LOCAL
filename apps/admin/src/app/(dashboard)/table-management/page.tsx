'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, X, Users, MapPin } from 'lucide-react';
import styles from '../tables/page.module.css';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import Portal from '@/components/ui/Portal';

const STATUS_MAP: Record<string, { label: string; color: string; bg: string; border: string }> = {
  AVAILABLE: { label: 'Boş',     color: 'var(--success)',  bg: 'var(--success-bg)',  border: 'var(--success-border)' },
  OCCUPIED:  { label: 'Dolu',    color: 'var(--danger)',   bg: 'var(--danger-bg)',   border: 'var(--danger-border)' },
  RESERVED:  { label: 'Rezerve', color: 'var(--warning)',  bg: 'var(--warning-bg)',  border: 'var(--warning-border)' },
};

export default function TableManagementPage() {
  const toast = useToast();
  const [activeZone, setActiveZone] = useState('Tümü');
  const [tables, setTables] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [newTable, setNewTable] = useState({ number: '', capacity: 4, zone: 'Salon' });
  const [editTable, setEditTable] = useState<any>(null);

  const existingZones = Array.from(new Set(tables.map(t => (t.zone?.name || t.zone || '').toString().trim()))).filter(Boolean);
  const dynamicZones = ['Tümü', ...existingZones];

  useEffect(() => {
    const isAnyModalOpen = showModal || showEditModal;
    document.body.style.overflow = isAnyModalOpen ? 'hidden' : 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [showModal, showEditModal]);

  const loadTables = useCallback(async () => {
    try {
      const data = await api.get('/tables');
      const sorted = [...data].sort((a: any, b: any) => String(a.number).localeCompare(String(b.number), 'tr-TR', { numeric: true }));
      setTables(sorted);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/tables', {
        number: newTable.number,
        capacity: Number(newTable.capacity),
        zone: newTable.zone,
      });
      toast.success('Masa başarıyla eklendi');
      setShowModal(false);
      setNewTable({ number: '', capacity: 4, zone: existingZones[0] || 'Salon' });
      setIsLoading(true);
      await loadTables();
    } catch (err) {
      toast.error('Masa eklenemedi.');
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    const previousTables = [...tables];
    const updatedTable = { ...editTable };

    setTables(prev => {
      const newTables = prev.map(t => t.id === editTable.id ? updatedTable : t);
      return newTables.sort((a: any, b: any) => String(a.number).localeCompare(String(b.number), 'tr-TR', { numeric: true }));
    });
    setShowEditModal(false);

    try {
      await api.patch(`/tables/${editTable.id}`, {
        number: editTable.number,
        capacity: Number(editTable.capacity),
        zone: editTable.zone,
        status: editTable.status
      });
      toast.success('Masa güncellendi');
    } catch (err) {
      setTables(previousTables);
      toast.error('Masa güncellenemedi.');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Bu masayı silmek istediğinize emin misiniz?')) {
      const previousTables = [...tables];
      setTables(prev => prev.filter(t => t.id !== id));

      try {
        await api.delete(`/tables/${id}`);
        toast.success('Masa silindi');
      } catch (err) {
        setTables(previousTables);
        toast.error('Masa silinemedi.');
      }
    }
  };

  const filtered = tables.filter(t => {
    if (activeZone === 'Tümü') return true;
    return (t.zone?.name || t.zone || '').toString().toLocaleUpperCase('tr-TR') === activeZone.toLocaleUpperCase('tr-TR');
  });

  return (
    <div className="animate-fade-in">
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Masa Yönetimi</h1>
          <p className={styles.subtitle}>Masa ekle, numarasını/bölümünü/kapasitesini düzenle veya sil</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={15} strokeWidth={2.5} />
            <span>Yeni Masa</span>
          </button>
        </div>
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
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.tableGrid}>
          {filtered.length === 0 && <p style={{ color: 'var(--text-tertiary)', padding: 16 }}>Bu bölümde kayıtlı masa bulunmuyor.</p>}
          {filtered.map(table => {
            const s = STATUS_MAP[table.status] || STATUS_MAP['AVAILABLE'];

            return (
              <div
                key={table.id}
                className={`${styles.tableCard} hover-pop`}
                style={{ borderColor: s.color }}
                onClick={() => { setEditTable(table); setShowEditModal(true); }}
              >
                <div style={{ position: 'absolute', top: 10, right: 10 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(table.id); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: 'var(--text-tertiary)', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    className="hover-bg"
                    title="Sil"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
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
              </div>
            );
          })}
        </div>
      )}

      {/* Datalist for zones */}
      <datalist id="zones-list">
        {existingZones.map(z => <option key={z} value={z} />)}
      </datalist>

      {/* Add Modal */}
      {showModal && (
        <Portal>
          <div className="modal-overlay" onClick={() => setShowModal(false)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setShowModal(false)}>
                <X size={18} />
              </button>
              <div className="modal-header">
                <h3 className="modal-title">Yeni Masa Ekle</h3>
              </div>
              <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div className="input-group">
                  <label>Masa Numarası</label>
                  <input required autoFocus type="text" className="input" value={newTable.number} onChange={e => setNewTable({...newTable, number: e.target.value})} />
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Kapasite (Kişi)</label>
                    <input required type="number" className="input" value={newTable.capacity} onChange={e => setNewTable({...newTable, capacity: Number(e.target.value)})} />
                  </div>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Bölüm</label>
                    <input required list="zones-list" className="input" placeholder="Yeni veya mevcut bölüm..." value={newTable.zone} onChange={e => setNewTable({...newTable, zone: e.target.value})} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                  <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowModal(false)}>İptal</button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Kaydet</button>
                </div>
              </form>
            </div>
          </div>
        </Portal>
      )}

      {/* Edit Modal */}
      {showEditModal && editTable && (
        <Portal>
          <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setShowEditModal(false)}>
                <X size={18} />
              </button>
              <div className="modal-header">
                <h3 className="modal-title">Masayı Düzenle ({editTable.number})</h3>
              </div>
              <form onSubmit={handleEdit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="input-group">
                  <label>Masa Numarası</label>
                  <input required autoFocus type="text" className="input" value={editTable.number} onChange={e => setEditTable({...editTable, number: e.target.value})} />
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Kapasite (Kişi)</label>
                    <input required type="number" className="input" value={editTable.capacity} onChange={e => setEditTable({...editTable, capacity: Number(e.target.value)})} />
                  </div>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Bölüm</label>
                    <input required list="zones-list" className="input" placeholder="Bölüm yazın..." value={editTable.zone} onChange={e => setEditTable({...editTable, zone: e.target.value})} />
                  </div>
                </div>
                <div className="input-group">
                  <label>Durum</label>
                  <select required className="input" value={editTable.status} onChange={e => setEditTable({...editTable, status: e.target.value})}>
                    <option value="AVAILABLE">Boş (Available)</option>
                    <option value="OCCUPIED">Dolu (Occupied)</option>
                    <option value="RESERVED">Rezerve</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowEditModal(false)}>İptal</button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Güncelle</button>
                </div>
              </form>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
