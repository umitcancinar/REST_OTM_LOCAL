'use client';

import { useState, useEffect } from 'react';
import { Plus, Settings2, Trash2, X, Phone, MapPin, User as UserIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import Portal from '@/components/ui/Portal';

export default function CustomersPage() {
  const toast = useToast();
  const [customers, setCustomers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  
  const [form, setForm] = useState({ name: '', phone: '', address: '', notes: '' });
  const [editCustomer, setEditCustomer] = useState<any>(null);

  // Body scroll lock
  useEffect(() => {
    const isAnyModalOpen = showModal || showEditModal;
    if (isAnyModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [showModal, showEditModal]);

  async function loadCustomers() {
    try {
      const data = await api.get('/customers');
      setCustomers(data);
    } catch (err) {
      console.error(err);
      toast.error('Müşteriler yüklenemedi.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadCustomers();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/customers', form);
      toast.success('Müşteri başarıyla eklendi');
      setShowModal(false);
      setForm({ name: '', phone: '', address: '', notes: '' });
      setIsLoading(true);
      await loadCustomers();
    } catch (err) {
      toast.error('Müşteri eklenemedi.');
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.patch(`/customers/${editCustomer.id}`, {
        name: editCustomer.name,
        phone: editCustomer.phone,
        address: editCustomer.address,
        notes: editCustomer.notes
      });
      toast.success('Müşteri güncellendi');
      setShowEditModal(false);
      setIsLoading(true);
      await loadCustomers();
    } catch (err) {
      toast.error('Müşteri güncellenemedi.');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Bu müşteriyi silmek istediğinize emin misiniz?')) {
      try {
        await api.delete(`/customers/${id}`);
        toast.success('Müşteri silindi');
        setIsLoading(true);
        await loadCustomers();
      } catch (err) {
        toast.error('Müşteri silinemedi.');
      }
    }
  };

  const filtered = customers.filter(c => 
    c.name.toLocaleLowerCase('tr-TR').includes(search.toLocaleLowerCase('tr-TR')) || 
    c.phone.includes(search)
  );

  return (
    <div className="animate-fade-in" style={{ padding: '0 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24, marginTop: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Müşteri Kayıtları</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Paket siparişler için kayıtlı {customers.length} müşteri</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
           <input 
             type="text" 
             className="input" 
             placeholder="İsim veya telefon ara..." 
             value={search}
             onChange={e => setSearch(e.target.value)}
             style={{ width: 250 }}
           />
           <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={15} strokeWidth={2.5} />
            <span>Müşteri Ekle</span>
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
         {isLoading ? (
            <div style={{ padding: 24 }}>Yükleniyor...</div>
         ) : (
            <table className="data-table">
               <thead>
                  <tr>
                     <th>Müşteri Adı</th>
                     <th>Telefon</th>
                     <th>Adres</th>
                     <th>İşlem</th>
                  </tr>
               </thead>
               <tbody>
                  {filtered.length === 0 && (
                     <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--text-tertiary)' }}>Müşteri kaydı bulunmuyor.</td></tr>
                  )}
                  {filtered.map(customer => (
                     <tr key={customer.id}>
                        <td>
                           <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                             <div style={{ width: 32, height: 32, borderRadius: 16, background: 'var(--bg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                                <UserIcon size={16} />
                             </div>
                             <strong>{customer.name}</strong>
                           </div>
                        </td>
                        <td>
                           <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                              <Phone size={14} /> {customer.phone}
                           </span>
                        </td>
                        <td>
                           <span style={{ display: 'flex', alignItems: 'flex-start', gap: 6, color: 'var(--text-secondary)', maxWidth: 400 }}>
                              <MapPin size={14} style={{ marginTop: 2, flexShrink: 0 }} /> 
                              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{customer.address || '-'}</span>
                           </span>
                        </td>
                        <td>
                           <div style={{ display: 'flex', gap: 6 }}>
                             <button className="btn btn-ghost btn-sm" onClick={() => { setEditCustomer(customer); setShowEditModal(true); }}><Settings2 size={16} /></button>
                             <button className="btn btn-ghost btn-sm" style={{ color: 'var(--accent-danger)' }} onClick={() => handleDelete(customer.id)}><Trash2 size={16} /></button>
                           </div>
                        </td>
                     </tr>
                  ))}
               </tbody>
            </table>
         )}
      </div>

      {showModal && (
        <Portal>
          <div className="modal-overlay" onClick={() => setShowModal(false)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3 className="modal-title">Yeni Müşteri Ekle</h3>
                <button onClick={() => setShowModal(false)} className="close-btn"><X size={16} /></button>
              </div>
              <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="input-group">
                  <label>İsim Soyisim</label>
                  <input required autoFocus type="text" className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
                </div>
                <div className="input-group">
                  <label>Telefon</label>
                  <input required type="text" className="input" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="05XX XXX XX XX" />
                </div>
                <div className="input-group">
                  <label>Adres</label>
                  <textarea className="input" rows={3} value={form.address} onChange={e => setForm({...form, address: e.target.value})} />
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowModal(false)}>İptal</button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Kaydet</button>
                </div>
              </form>
            </div>
          </div>
        </Portal>
      )}


      {showEditModal && editCustomer && (
        <Portal>
          <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3 className="modal-title">Müşteriyi Düzenle</h3>
                <button onClick={() => setShowEditModal(false)} className="close-btn"><X size={16} /></button>
              </div>
              <form onSubmit={handleEdit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="input-group">
                  <label>İsim Soyisim</label>
                  <input required autoFocus type="text" className="input" value={editCustomer.name} onChange={e => setEditCustomer({...editCustomer, name: e.target.value})} />
                </div>
                <div className="input-group">
                  <label>Telefon</label>
                  <input required type="text" className="input" value={editCustomer.phone} onChange={e => setEditCustomer({...editCustomer, phone: e.target.value})} />
                </div>
                <div className="input-group">
                  <label>Adres</label>
                  <textarea className="input" rows={3} value={editCustomer.address} onChange={e => setEditCustomer({...editCustomer, address: e.target.value})} />
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
