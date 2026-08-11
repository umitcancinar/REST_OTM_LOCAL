'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Plus, Search, CheckCircle2, XCircle, MoreVertical } from 'lucide-react';
import styles from './page.module.css';

export default function TenantsPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchTenants = async () => {
    try {
      const data = await api.get('/tenants');
      setTenants(data);
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
        <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
    </div>
  );
}
