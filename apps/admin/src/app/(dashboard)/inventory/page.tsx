'use client';

import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import styles from './page.module.css';
import { api } from '@/lib/api';
import Portal from '@/components/ui/Portal';
import { X } from 'lucide-react';

export default function InventoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', qty: '', unit: 'KILOGRAM', minLevel: '', cost: '' });

  const [showEditModal, setShowEditModal] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);

  async function loadInventory() {
    try {
      const data = await api.get('/inventory');
      setItems(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadInventory();
  }, []);

  const exportToExcel = () => {
    const dataToExport = items.map(item => ({
      'Ürün Adı': item.name,
      'Mevcut Stok': item.currentStock,
      'Birim': item.unit === 'PIECE' ? 'Adet' : item.unit === 'LITER' ? 'Litre' : 'KG',
      'Kritik Eşik': item.minStockAlert,
      'Birim Maliyet': `₺${item.costPerUnit}`,
      'Toplam Değer': `₺${(item.currentStock * item.costPerUnit).toFixed(2)}`,
      'Durum': item.currentStock <= item.minStockAlert ? 'KRİTİK' : 'YETERLİ'
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Stok Listesi');
    XLSX.writeFile(workbook, `Rest_OTM_Stok_${new Date().toLocaleDateString('tr-TR')}.xlsx`);
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/inventory', {
        name: newItem.name,
        unit: newItem.unit,
        currentStock: Number(newItem.qty),
        minStockAlert: Number(newItem.minLevel),
        costPerUnit: Number(newItem.cost)
      });
      setShowAddModal(false);
      setNewItem({ name: '', qty: '', unit: 'KILOGRAM', minLevel: '', cost: '' });
      setIsLoading(true);
      await loadInventory();
    } catch (err) {
      alert('Stok eklenirken hata oluştu');
    }
  };

  const handleEditItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const previousItems = [...items];
    const updatedItem = { ...editItem };
    
    // Optimistic Update
    setItems(prev => prev.map(item => item.id === editItem.id ? updatedItem : item));
    setShowEditModal(false);

    try {
      await api.patch(`/inventory/${editItem.id}`, {
        name: editItem.name,
        unit: editItem.unit,
        currentStock: Number(editItem.currentStock),
        minStockAlert: Number(editItem.minStockAlert),
        costPerUnit: Number(editItem.costPerUnit)
      });
      // toast.success('Stok güncellendi'); // If useToast is available here, otherwise ignore
    } catch (err) {
      setItems(previousItems);
      alert('Stok güncellenirken hata oluştu');
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (confirm('Bu stoğu silmek istediğinize emin misiniz?')) {
      const previousItems = [...items];
      
      // Optimistic Update
      setItems(prev => prev.filter(item => item.id !== id));

      try {
        await api.delete(`/inventory/${id}`);
      } catch (err) {
        setItems(previousItems);
        alert('Stok silinemedi');
      }
    }
  };

  const getStatus = (qty: number, min: number) => {
    if (qty <= min * 0.5) return { label: 'Kritik', badge: 'badge-danger' };
    if (qty <= min) return { label: 'Azalıyor', badge: 'badge-warning' };
    return { label: 'Yeterli', badge: 'badge-success' };
  };

  const criticalCount = items.filter(i => i.currentStock <= i.minStockAlert).length;

  return (
    <div className="animate-fade-in">
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Stok Yönetimi</h1>
          <p className={styles.subtitle}>Envanter durumu ve stok takibi</p>
        </div>
        <div className={styles.headerActions}>
           <button className="btn btn-ghost" onClick={exportToExcel}>Dışarı Aktar (Excel)</button>
           <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>+ Stok Ekle</button>
        </div>
      </div>

      {isLoading ? (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Ürün Adı</th>
                <th>Mevcut Miktar</th>
                <th>Kritik Eşik</th>
                <th>Birim Maliyet</th>
                <th>Durum</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {[1,2,3,4,5].map(i => (
                <tr key={i}>
                  <td><div className="skeleton" style={{ height: 20, width: 140 }} /></td>
                  <td><div className="skeleton" style={{ height: 24, width: 80 }} /></td>
                  <td><div className="skeleton" style={{ height: 20, width: 80 }} /></td>
                  <td><div className="skeleton" style={{ height: 20, width: 60 }} /></td>
                  <td><div className="skeleton" style={{ height: 24, width: 70, borderRadius: 12 }} /></td>
                  <td><div className="skeleton" style={{ height: 20, width: 100 }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
            <div className="card" style={{ padding: 0 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ürün Adı</th>
                    <th>Mevcut Miktar</th>
                    <th>Kritik Eşik</th>
                    <th>Birim Maliyet</th>
                    <th>Durum</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: '16px' }}>Kayıtlı stok bulunamadı.</td></tr>
                  ) : items.map(item => {
                    const s = getStatus(item.currentStock, item.minStockAlert);
                    return (
                      <tr key={item.id}>
                        <td><strong>{item.name}</strong></td>
                        <td style={{ fontSize: '1.125rem', fontWeight: 700 }}>
                          {item.currentStock} <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{item.unit === 'PIECE' ? 'adet' : 'kg/L'}</span>
                        </td>
                        <td>{item.minStockAlert} {item.unit === 'PIECE' ? 'adet' : 'kg/L'}</td>
                        <td>₺{item.costPerUnit}</td>
                        <td><span className={`badge ${s.badge}`}>{s.label}</span></td>
                        <td>
                          <div className={styles.actions}>
                             <button className={styles.actionBtn} style={{ color: 'var(--accent-danger)' }} onClick={() => handleDeleteItem(item.id)}>Sil</button>
                             <button className={styles.actionBtn} onClick={() => { setEditItem(item); setShowEditModal(true); }}>Düzelt</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <Portal>
          <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>
                <X size={18} />
              </button>
              <div className="modal-header">
                <h3 className="modal-title">Yeni Stok Ekle</h3>
              </div>
              <form onSubmit={handleAddItem} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div className="input-group">
                  <label>Ürün Adı</label>
                  <input required autoFocus type="text" className="input" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} />
                </div>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Birim</label>
                    <select className="input" value={newItem.unit} onChange={e => setNewItem({...newItem, unit: e.target.value})}>
                      <option value="KILOGRAM">Kilogram (kg)</option>
                      <option value="LITER">Litre (L)</option>
                      <option value="PIECE">Adet</option>
                    </select>
                  </div>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Miktar</label>
                    <input required type="number" step="0.01" className="input" value={newItem.qty} onChange={e => setNewItem({...newItem, qty: e.target.value})} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Kritik Eşik</label>
                    <input required type="number" step="0.01" className="input" value={newItem.minLevel} onChange={e => setNewItem({...newItem, minLevel: e.target.value})} />
                  </div>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Birim Maliyet (₺)</label>
                    <input required type="number" step="0.01" className="input" value={newItem.cost} onChange={e => setNewItem({...newItem, cost: e.target.value})} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                  <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowAddModal(false)}>İptal</button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Kaydet</button>
                </div>
              </form>
            </div>
          </div>
        </Portal>
      )}

      {/* Edit Modal */}
      {showEditModal && editItem && (
        <Portal>
          <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setShowEditModal(false)}>
                <X size={18} />
              </button>
              <div className="modal-header">
                <h3 className="modal-title">Stoğu Düzenle</h3>
              </div>
              <form onSubmit={handleEditItem} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div className="input-group">
                  <label>Ürün Adı</label>
                  <input required autoFocus type="text" className="input" value={editItem.name} onChange={e => setEditItem({...editItem, name: e.target.value})} />
                </div>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Birim</label>
                    <select className="input" value={editItem.unit} onChange={e => setEditItem({...editItem, unit: e.target.value})}>
                      <option value="KILOGRAM">Kilogram (kg)</option>
                      <option value="LITER">Litre (L)</option>
                      <option value="PIECE">Adet</option>
                    </select>
                  </div>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Miktar</label>
                    <input required type="number" step="0.01" className="input" value={editItem.currentStock} onChange={e => setEditItem({...editItem, currentStock: e.target.value})} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Kritik Eşik</label>
                    <input required type="number" step="0.01" className="input" value={editItem.minStockAlert} onChange={e => setEditItem({...editItem, minStockAlert: e.target.value})} />
                  </div>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Birim Maliyet (₺)</label>
                    <input required type="number" step="0.01" className="input" value={editItem.costPerUnit} onChange={e => setEditItem({...editItem, costPerUnit: e.target.value})} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
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
