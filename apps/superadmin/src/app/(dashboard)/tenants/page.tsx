'use client';

import { FormEvent, useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Plus, Search, CheckCircle2, XCircle, MoreVertical, X, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import styles from './page.module.css';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  customDomain: string | null;
  isActive: boolean;
  createdAt: string;
}

function slugify(value: string) {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function TenantsPage() {
  const toast = useToast();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', customDomain: '', email: '', adminEmail: '', adminPassword: '' });

  const fetchTenants = async () => {
    try {
      const data = await api.get('/tenants');
      setTenants(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch tenants', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
    const query = new URLSearchParams(window.location.search).get('q');
    if (query) setSearchTerm(query);
  }, []);

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    try {
      const created = await api.post('/tenants', {
        name: form.name.trim(),
        slug: form.slug.trim(),
        customDomain: form.customDomain.trim() || null,
        email: form.email.trim() || undefined,
        adminEmail: form.adminEmail.trim() || undefined,
        adminPassword: form.adminPassword || undefined,
      }) as Tenant;
      setTenants((current) => [created, ...current]);
      setCreateOpen(false);
      setForm({ name: '', slug: '', customDomain: '', email: '', adminEmail: '', adminPassword: '' });
      toast.success('Restoran oluşturuldu. Şimdi Lisans Yönetimi ekranından lisans üretebilirsiniz.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Restoran oluşturulamadı.');
    } finally {
      setCreating(false);
    }
  }

  const filteredTenants = tenants.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    t.slug.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Restoran Müşterileri</h1>
          <p className={styles.subtitle}>Sistemdeki tüm restoranları yönetin</p>
        </div>
        <button type="button" onClick={() => setCreateOpen(true)} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Plus size={18} />
          Yeni Müşteri Ekle
        </button>
      </div>

      <div className="card" style={{ padding: '24px', backgroundColor: 'white', borderRadius: '12px', marginTop: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #e2e8f0', padding: '8px 16px', borderRadius: '8px', marginBottom: '24px' }}>
          <Search size={18} style={{ color: '#94a3b8', marginRight: '8px' }} />
          <input 
            type="text" 
            placeholder="Restoran adı veya slug ara..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ border: 'none', outline: 'none', width: '100%' }}
          />
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center' }}>Yükleniyor...</div>
        ) : (
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #f1f5f9', textAlign: 'left' }}>
                <th style={{ padding: '16px 8px', color: '#64748b' }}>Restoran Adı</th>
                <th style={{ padding: '16px 8px', color: '#64748b' }}>Slug (URL)</th>
                <th style={{ padding: '16px 8px', color: '#64748b' }}>Özel Domain</th>
                <th style={{ padding: '16px 8px', color: '#64748b' }}>Durum</th>
                <th style={{ padding: '16px 8px', color: '#64748b' }}>Oluşturulma</th>
                <th style={{ padding: '16px 8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                    Kayıtlı restoran bulunamadı
                  </td>
                </tr>
              ) : (
                filteredTenants.map((tenant) => (
                  <tr key={tenant.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '16px 8px', fontWeight: 600 }}>{tenant.name}</td>
                    <td style={{ padding: '16px 8px', color: '#64748b' }}>{tenant.slug}</td>
                    <td style={{ padding: '16px 8px', color: '#64748b' }}>{tenant.customDomain || '-'}</td>
                    <td style={{ padding: '16px 8px' }}>
                      {tenant.isActive !== false ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', backgroundColor: '#dcfce7', color: '#166534', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                          <CheckCircle2 size={14} /> Aktif
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', backgroundColor: '#fee2e2', color: '#991b1b', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                          <XCircle size={14} /> Pasif
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '16px 8px', color: '#64748b' }}>
                      {new Date(tenant.createdAt).toLocaleDateString('tr-TR')}
                    </td>
                    <td style={{ padding: '16px 8px', textAlign: 'right' }}>
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                        <MoreVertical size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {createOpen && (
        <div className={styles.overlay} onMouseDown={(event) => event.target === event.currentTarget && !creating && setCreateOpen(false)}>
          <form className={styles.modal} onSubmit={createTenant} role="dialog" aria-modal="true" aria-labelledby="tenant-create-title">
            <button type="button" className={styles.close} disabled={creating} onClick={() => setCreateOpen(false)} aria-label="Kapat"><X size={18} /></button>
            <h2 id="tenant-create-title">Yeni restoran müşterisi</h2>
            <p>Restoran kaydı oluşturulur; lisans anahtarı ayrı olarak Lisans Yönetimi ekranından üretilir.</p>
            <label>Restoran adı<input required minLength={2} value={form.name} onChange={(event) => {
              const name = event.target.value;
              setForm((current) => ({ ...current, name, slug: current.slug === slugify(current.name) ? slugify(name) : current.slug }));
            }} /></label>
            <label>Slug (URL)<input required minLength={2} pattern="[a-z0-9-]+" value={form.slug} onChange={(event) => setForm((current) => ({ ...current, slug: slugify(event.target.value) }))} placeholder="ornek-restoran" /></label>
            <label>Özel domain <span>(isteğe bağlı)</span><input value={form.customDomain} onChange={(event) => setForm((current) => ({ ...current, customDomain: event.target.value }))} placeholder="menu.ornekrestoran.com" /></label>
            <label>İşletme e-postası <span>(isteğe bağlı)</span><input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
            <div className={styles.formRow}>
              <label>Yönetici e-postası <span>(isteğe bağlı)</span><input type="email" value={form.adminEmail} onChange={(event) => setForm((current) => ({ ...current, adminEmail: event.target.value }))} /></label>
              <label>İlk parola <span>(en az 6 karakter)</span><input type="password" minLength={6} value={form.adminPassword} onChange={(event) => setForm((current) => ({ ...current, adminPassword: event.target.value }))} /></label>
            </div>
            <div className={styles.modalActions}>
              <button type="button" disabled={creating} onClick={() => setCreateOpen(false)}>Vazgeç</button>
              <button className="btn btn-primary" type="submit" disabled={creating}>{creating ? <Loader2 className={styles.spin} size={17} /> : <Plus size={17} />} Restoranı oluştur</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
