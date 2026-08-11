'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Building2 } from 'lucide-react';

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState({ totalTenants: 0, totalUsers: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const tenants = await api.get('/tenants');
        setStats({ totalTenants: tenants?.length || 0, totalUsers: 0 });
      } catch (error) {
        console.error('Failed to fetch superadmin stats', error);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  if (loading) return <div className="p-8">Yükleniyor...</div>;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Sistem Genel Bakış</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card flex items-center p-6 gap-4" style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px' }}>
          <div className="bg-primary/10 p-4 rounded-xl text-primary" style={{ backgroundColor: 'var(--primary-bg)', color: 'var(--primary)', padding: '16px', borderRadius: '12px' }}>
            <Building2 size={32} />
          </div>
          <div>
            <p className="text-sm text-gray-500 font-medium" style={{ color: 'var(--text-secondary)' }}>Toplam Restoran (Müşteri)</p>
            <h2 className="text-3xl font-bold" style={{ fontSize: '2rem', fontWeight: 800 }}>{stats.totalTenants}</h2>
          </div>
        </div>
      </div>
    </div>
  );
}
