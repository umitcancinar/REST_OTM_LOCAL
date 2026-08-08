'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  Building2, LogIn, Plus, Globe,
  CalendarDays, CreditCard, Trash2, X, AlertTriangle,
  Search, ShieldCheck, Users, Activity, Crown, BarChart3,
  Settings, Zap, Monitor, Clock, PlusCircle, MinusCircle, Loader2
} from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import Portal from '@/components/ui/Portal';

/** subscriptionExpiresAt'tan kalan gun + renk hesaplar. */
function subscriptionStatus(subscriptionExpiresAt: string | null | undefined) {
  if (!subscriptionExpiresAt) {
    return { label: 'Süre ayarlanmamış', color: 'var(--text-tertiary)', days: null as number | null };
  }
  const ms = new Date(subscriptionExpiresAt).getTime() - Date.now();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return { label: `Süresi ${Math.abs(days)} gün önce doldu`, color: '#ef4444', days };
  if (days === 0) return { label: 'Bugün doluyor', color: '#ef4444', days };
  if (days <= 7) return { label: `${days} gün kaldı`, color: '#ef4444', days };
  if (days <= 14) return { label: `${days} gün kaldı`, color: '#f59e0b', days };
  return { label: `${days} gün kaldı`, color: '#10b981', days };
}

const SUBSCRIPTION_STEPS = [
  { label: '1 Ay', months: 1 },
  { label: '3 Ay', months: 3 },
  { label: '6 Ay', months: 6 },
  { label: '1 Yıl', months: 12 },
];

export default function SuperAdminPage() {
  const [tenants, setTenants] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [adjustingTenantId, setAdjustingTenantId] = useState<string | null>(null);
  const toast = useToast();

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [deleteTenantId, setDeleteTenantId] = useState<string | null>(null);

  // New Tenant Form State
  const [newTenant, setNewTenant] = useState({
    name: '',
    slug: '',
    adminEmail: '',
    adminPassword: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = async () => {
    try {
      setIsLoading(true);
      const res = await api.get('/tenants');
      setTenants(res);
    } catch (error) {
      toast.error('Restoranlar yüklenirken hata oluştu.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImpersonate = (tenantId: string, tenantName: string, features: any) => {
    localStorage.setItem('impersonatedTenantId', tenantId);
    localStorage.setItem('impersonatedTenantName', tenantName);
    localStorage.setItem('impersonatedFeatures', JSON.stringify(features));
    toast.success(`${tenantName} hesabına geçiş yapıldı. Yönlendiriliyorsunuz...`);
    window.location.href = '/overview';
  };

  const toggleFeature = async (tenantId: string, feature: string, currentValue: boolean) => {
    try {
      const tenant = tenants.find(t => t.id === tenantId);
      if (!tenant) return;
      
      let settings = tenant.settings;
      if (typeof settings === 'string') {
        try { settings = JSON.parse(settings); } catch (e) { settings = {}; }
      }
      settings = settings || {};
      
      const features = settings.features || {
        website: true, reservations: true, takeaway: true, pos: true
      };

      const updatedSettings = {
        ...settings,
        features: {
          ...features,
          [feature]: !currentValue
        }
      };

      // Optimistic Update
      setTenants(prev => prev.map(t => {
        if (t.id === tenantId) return { ...t, settings: updatedSettings };
        return t;
      }));

      await api.patch(`/tenants/${tenantId}`, { settings: updatedSettings });
      toast.success('Lisans başarıyla güncellendi.');
    } catch (err) {
      toast.error('Lisans güncellenemedi.');
      fetchTenants(); // Revert on failure
    }
  };

  /**
   * Uyelik suresini uzatir (months > 0) veya azaltir (months < 0).
   * PATCH /tenants/:id/subscription — yalnizca SUPER_ADMIN cagirabilir
   * (bkz. apps/api/src/modules/tenants/tenant.routes.ts).
   */
  const handleAdjustSubscription = async (tenantId: string, months: number) => {
    if (adjustingTenantId) return; // ayni anda ikinci istegi engelle
    setAdjustingTenantId(tenantId);
    try {
      const updated = await api.patch(`/tenants/${tenantId}/subscription`, { months });
      setTenants(prev => prev.map(t => (t.id === tenantId ? { ...t, subscriptionExpiresAt: updated.subscriptionExpiresAt } : t)));
      toast.success(months > 0 ? `Üyelik ${months} ay uzatıldı.` : `Üyelik ${Math.abs(months)} ay azaltıldı.`);
    } catch (err) {
      toast.error('Üyelik süresi güncellenemedi.');
    } finally {
      setAdjustingTenantId(null);
    }
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api.post('/tenants', newTenant);
      toast.success('Yeni restoran başarıyla oluşturuldu!');
      setIsAddModalOpen(false);
      setNewTenant({ name: '', slug: '', adminEmail: '', adminPassword: '' });
      fetchTenants();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Restoran oluşturulurken hata oluştu.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteTenant = async () => {
    if (!deleteTenantId) return;
    try {
      await api.delete(`/tenants/${deleteTenantId}`);
      toast.success('Restoran kalıcı olarak silindi.');
      setDeleteTenantId(null);
      fetchTenants();
    } catch (err: any) {
      toast.error('Restoran silinemedi.');
    }
  };

  const filteredTenants = tenants.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.slug.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalUsers = tenants.reduce((s, t) => s + (t._count?.users || 0), 0);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 1440, margin: '0 auto', padding: '0 8px' }}>

      {/* ─── Hero Header ─────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #4c1d95 100%)',
        borderRadius: 20,
        padding: '36px 40px',
        color: '#fff',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Decorative Circles */}
        <div style={{ position: 'absolute', top: -40, right: -40, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
        <div style={{ position: 'absolute', bottom: -60, right: 80, width: 240, height: 240, borderRadius: '50%', background: 'rgba(255,255,255,0.03)' }} />
        <div style={{ position: 'absolute', top: 20, right: 160, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 20, position: 'relative', zIndex: 1 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
              <div style={{
                width: 52, height: 52, borderRadius: 16,
                background: 'rgba(255,255,255,0.15)',
                backdropFilter: 'blur(20px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid rgba(255,255,255,0.2)',
              }}>
                <Crown size={28} strokeWidth={1.8} color="#fbbf24" />
              </div>
              <div>
                <h1 style={{ fontSize: '1.875rem', fontWeight: 900, lineHeight: 1.2 }}>Sistem Yönetimi</h1>
                <p style={{ fontSize: '0.9375rem', opacity: 0.7, marginTop: 4 }}>Müşteri lisansları, yetkilendirme ve restoran yönetimi</p>
              </div>
            </div>
          </div>

          <button 
            onClick={() => setIsAddModalOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 24px', borderRadius: 14,
              background: 'rgba(255,255,255,0.15)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.25)',
              color: '#fff', fontWeight: 700, fontSize: '0.9375rem',
              cursor: 'pointer', transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.25)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
          >
            <Plus size={18} strokeWidth={2.5} /> Yeni Restoran
          </button>
        </div>

        {/* Quick Stats */}
        <div style={{ display: 'flex', gap: 24, marginTop: 28, position: 'relative', zIndex: 1 }}>
          <QuickStat icon={<Building2 size={18} />} label="Toplam Restoran" value={String(tenants.length)} />
          <QuickStat icon={<Users size={18} />} label="Toplam Kullanıcı" value={String(totalUsers)} />
          <QuickStat icon={<Activity size={18} />} label="Aktif Sistem" value={`${tenants.length}/${tenants.length}`} />
        </div>
      </div>

      {/* ─── Search ─────────────────────────────────────── */}
      <div style={{ position: 'relative', maxWidth: 480 }}>
        <Search size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input 
          type="text" 
          placeholder="Restoran adı veya slug ile ara..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input"
          style={{ paddingLeft: 44, borderRadius: 14, height: 48 }}
        />
      </div>

      {/* ─── Tenant Cards ──────────────────────────────── */}
      {isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 20 }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="card" style={{ height: 360 }}>
              <div className="skeleton" style={{ width: '100%', height: '100%', borderRadius: 12 }} />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 20 }}>
          {filteredTenants.map(tenant => {
            let settings = tenant.settings;
            if (typeof settings === 'string') {
              try { settings = JSON.parse(settings); } catch (e) { settings = {}; }
            }
            settings = settings || {};

            const features = settings.features || {
              website: true, reservations: true, takeaway: true, pos: true
            };

            const createdDate = tenant.createdAt 
              ? new Date(tenant.createdAt).toLocaleDateString('tr-TR', { year: 'numeric', month: 'short', day: 'numeric' }) 
              : 'Bilinmiyor';

            const userCount = tenant._count?.users || 0;
            const planLabel = features.pos ? 'Pro Plan' : 'Temel Plan';
            const planColor = features.pos ? '#8b5cf6' : '#6b7280';
            const subStatus = subscriptionStatus(tenant.subscriptionExpiresAt);
            const isAdjustingThis = adjustingTenantId === tenant.id;

            return (
              <div 
                key={tenant.id} 
                className="card" 
                style={{ 
                  display: 'flex', flexDirection: 'column', 
                  padding: 0, overflow: 'hidden',
                  border: '1px solid var(--border)',
                  transition: 'all 0.3s ease',
                }}
                onMouseEnter={e => { 
                  e.currentTarget.style.transform = 'translateY(-2px)'; 
                  e.currentTarget.style.boxShadow = '0 12px 40px rgba(0,0,0,0.12)';
                  e.currentTarget.style.borderColor = 'var(--accent)';
                }}
                onMouseLeave={e => { 
                  e.currentTarget.style.transform = 'translateY(0)'; 
                  e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  e.currentTarget.style.borderColor = 'var(--border)';
                }}
              >
                {/* Card Header */}
                <div style={{ padding: '24px 24px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                      <div style={{
                        width: 48, height: 48, borderRadius: 14,
                        background: 'linear-gradient(135deg, var(--accent), #7c3aed)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', flexShrink: 0,
                        boxShadow: '0 4px 12px rgba(109,40,217,0.25)',
                      }}>
                        <Building2 size={24} strokeWidth={1.8} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                          {tenant.name}
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                          <span style={{ 
                            fontSize: '0.6875rem', fontFamily: 'monospace', fontWeight: 600,
                            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                            padding: '2px 8px', borderRadius: 6, color: 'var(--text-secondary)' 
                          }}>
                            {tenant.slug}
                          </span>
                          <span style={{ 
                            fontSize: '0.6875rem', fontWeight: 700,
                            background: planColor + '18', color: planColor,
                            padding: '2px 8px', borderRadius: 6, 
                          }}>
                            {planLabel}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button 
                      onClick={() => setDeleteTenantId(tenant.id)}
                      style={{
                        width: 34, height: 34, borderRadius: 10,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'transparent', border: '1px solid transparent',
                        color: 'var(--text-muted)', cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={e => { 
                        e.currentTarget.style.background = '#fef2f2'; 
                        e.currentTarget.style.borderColor = '#fca5a5';
                        e.currentTarget.style.color = '#ef4444'; 
                      }}
                      onMouseLeave={e => { 
                        e.currentTarget.style.background = 'transparent'; 
                        e.currentTarget.style.borderColor = 'transparent';
                        e.currentTarget.style.color = 'var(--text-muted)'; 
                      }}
                      title="Restoranı Sil"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  {/* Mini Stats Row */}
                  <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
                    <div style={{ 
                      flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                      padding: '10px 12px', borderRadius: 12,
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    }}>
                      <Users size={15} color="var(--accent)" />
                      <div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>Kullanıcılar</div>
                        <div style={{ fontSize: '0.9375rem', fontWeight: 800, color: 'var(--text-primary)' }}>{userCount}</div>
                      </div>
                    </div>
                    <div style={{ 
                      flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                      padding: '10px 12px', borderRadius: 12,
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    }}>
                      <CalendarDays size={15} color="#10b981" />
                      <div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>Katılım</div>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>{createdDate}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card Body — Actions */}
                <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
                  {/* Impersonate Button */}
                  <button 
                    onClick={() => handleImpersonate(tenant.id, tenant.name, features)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                      padding: '12px', borderRadius: 12, width: '100%',
                      background: 'linear-gradient(135deg, var(--accent), #7c3aed)',
                      color: '#fff', fontWeight: 700, fontSize: '0.875rem',
                      border: 'none', cursor: 'pointer',
                      boxShadow: '0 4px 14px rgba(109,40,217,0.3)',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(109,40,217,0.4)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(109,40,217,0.3)'; }}
                  >
                    <LogIn size={16} strokeWidth={2.5} /> İçeri Gir (Impersonate)
                  </button>

                  {/* Uyelik Suresi */}
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <h4 style={{
                        fontSize: '0.6875rem', fontWeight: 800, color: 'var(--text-tertiary)',
                        textTransform: 'uppercase', letterSpacing: '0.08em',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <Clock size={12} /> Üyelik Süresi
                      </h4>
                      <span style={{ fontSize: '0.75rem', fontWeight: 800, color: subStatus.color }}>
                        {isAdjustingThis ? <Loader2 size={13} className="animate-spin" /> : subStatus.label}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {SUBSCRIPTION_STEPS.map(step => (
                        <button
                          key={`add-${step.months}`}
                          type="button"
                          disabled={isAdjustingThis}
                          onClick={() => handleAdjustSubscription(tenant.id, step.months)}
                          title={`${step.label} ekle`}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            padding: '5px 9px', borderRadius: 8, fontSize: '0.6875rem', fontWeight: 700,
                            border: '1px solid #86efac', background: '#f0fdf4', color: '#15803d',
                            cursor: isAdjustingThis ? 'not-allowed' : 'pointer', opacity: isAdjustingThis ? 0.5 : 1,
                          }}
                        >
                          <PlusCircle size={11} /> {step.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {SUBSCRIPTION_STEPS.map(step => (
                        <button
                          key={`sub-${step.months}`}
                          type="button"
                          disabled={isAdjustingThis}
                          onClick={() => handleAdjustSubscription(tenant.id, -step.months)}
                          title={`${step.label} azalt`}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            padding: '5px 9px', borderRadius: 8, fontSize: '0.6875rem', fontWeight: 700,
                            border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-tertiary)',
                            cursor: isAdjustingThis ? 'not-allowed' : 'pointer', opacity: isAdjustingThis ? 0.5 : 1,
                          }}
                        >
                          <MinusCircle size={11} /> {step.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Feature Toggles */}
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                    <h4 style={{ 
                      fontSize: '0.6875rem', fontWeight: 800, color: 'var(--text-tertiary)', 
                      textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10,
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <Settings size={12} /> Modül Lisansları
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <FeatureToggle 
                        icon={<Globe size={14} />} 
                        label="Web Sitesi" 
                        isActive={features.website} 
                        onToggle={() => toggleFeature(tenant.id, 'website', features.website)} 
                      />
                      <FeatureToggle 
                        icon={<CalendarDays size={14} />} 
                        label="Rezervasyon" 
                        isActive={features.reservations} 
                        onToggle={() => toggleFeature(tenant.id, 'reservations', features.reservations)} 
                      />
                      <FeatureToggle 
                        icon={<Monitor size={14} />} 
                        label="POS Sistemi" 
                        isActive={features.pos} 
                        onToggle={() => toggleFeature(tenant.id, 'pos', features.pos)} 
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {filteredTenants.length === 0 && (
            <div className="card" style={{ gridColumn: '1/-1', padding: '80px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ 
                width: 64, height: 64, borderRadius: 20,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 16, color: 'var(--text-muted)'
              }}>
                <Search size={32} strokeWidth={1.5} />
              </div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>Restoran bulunamadı</h3>
              <p style={{ color: 'var(--text-secondary)', maxWidth: 360, fontSize: '0.9375rem' }}>
                Arama kriterlerinize uyan bir kayıt yok. Lütfen farklı bir isim veya slug ile tekrar deneyin.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ─── Add Tenant Modal ──────────────────────────── */}
      {isAddModalOpen && (
        <Portal>
          <div className="modal-overlay" onClick={() => setIsAddModalOpen(false)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setIsAddModalOpen(false)}>
                <X size={18} />
              </button>
              
              <div className="modal-header">
                <h3 className="modal-title">Yeni Restoran Ekle</h3>
              </div>
              
              <form onSubmit={handleCreateTenant}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <div className="input-group">
                    <label>Restoran Adı</label>
                    <input 
                      type="text" required
                      value={newTenant.name}
                      onChange={(e) => {
                        const name = e.target.value;
                        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
                        setNewTenant(prev => ({ ...prev, name, slug }));
                      }}
                      className="input"
                      placeholder="Örn: Tarihi Adana Kebapçısı"
                    />
                  </div>
                  <div className="input-group">
                    <label>URL / Slug</label>
                    <input 
                      type="text" required
                      value={newTenant.slug}
                      onChange={(e) => setNewTenant(prev => ({ ...prev, slug: e.target.value }))}
                      className="input"
                      style={{ fontFamily: 'monospace' }}
                      placeholder="tarihi-adana-kebapcisi"
                    />
                  </div>
                  
                  <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                  
                  <div style={{ marginBottom: 4 }}>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ShieldCheck size={16} color="var(--accent)" />
                      Yönetici (Owner) Bilgileri
                    </h4>
                  </div>
                  
                  <div className="input-group">
                    <label>Yönetici E-posta</label>
                    <input 
                      type="email" required
                      value={newTenant.adminEmail}
                      onChange={(e) => setNewTenant(prev => ({ ...prev, adminEmail: e.target.value }))}
                      className="input"
                      placeholder="yonetici@restoran.com"
                    />
                  </div>
                  <div className="input-group">
                    <label>Yönetici Şifresi</label>
                    <input 
                      type="password" required minLength={6}
                      value={newTenant.adminPassword}
                      onChange={(e) => setNewTenant(prev => ({ ...prev, adminPassword: e.target.value }))}
                      className="input"
                      placeholder="En az 6 karakter"
                    />
                  </div>
                </div>

                <div style={{ marginTop: 32, display: 'flex', gap: 12 }}>
                  <button 
                    type="button" 
                    onClick={() => setIsAddModalOpen(false)}
                    className="btn btn-secondary"
                    style={{ flex: 1 }}
                  >
                    İptal
                  </button>
                  <button 
                    type="submit" 
                    disabled={isSubmitting}
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                  >
                    {isSubmitting ? 'Oluşturuluyor...' : 'Oluştur'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </Portal>
      )}

      {/* ─── Delete Confirmation Modal ──────────────────── */}
      {deleteTenantId && (
        <Portal>
          <div className="modal-overlay" onClick={() => setDeleteTenantId(null)}>
            <div className="modal-box" style={{ maxWidth: 400, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
              <div style={{ 
                width: 64, height: 64, borderRadius: 20,
                background: '#fef2f2', border: '1px solid #fecaca',
                color: '#ef4444',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 24px',
              }}>
                <AlertTriangle size={32} strokeWidth={1.5} />
              </div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 12 }}>Restoranı Sil?</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 28, fontSize: '0.875rem', lineHeight: 1.6 }}>
                Bu işlem geri alınamaz. Restorana ait tüm veriler (menü, siparişler, personel) kalıcı olarak silinecektir.
              </p>
              
              <div style={{ display: 'flex', gap: 12 }}>
                <button 
                  onClick={() => setDeleteTenantId(null)}
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                >
                  Vazgeç
                </button>
                <button 
                  onClick={handleDeleteTenant}
                  className="btn btn-danger"
                  style={{ flex: 1 }}
                >
                  Evet, Sil
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

    </div>
  );
}

function QuickStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ 
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 18px', borderRadius: 14,
      background: 'rgba(255,255,255,0.08)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255,255,255,0.1)',
    }}>
      <div style={{ opacity: 0.8 }}>{icon}</div>
      <div>
        <div style={{ fontSize: '0.6875rem', opacity: 0.6, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: '1.25rem', fontWeight: 900 }}>{value}</div>
      </div>
    </div>
  );
}

function FeatureToggle({ icon, label, isActive, onToggle }: { icon: any, label: string, isActive: boolean, onToggle: () => void }) {
  return (
    <button 
      type="button"
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', padding: '8px 12px', borderRadius: 10,
        border: `1px solid ${isActive ? '#10b981' : 'var(--border)'}`,
        background: isActive ? '#ecfdf5' : 'var(--bg-elevated)',
        color: isActive ? '#059669' : 'var(--text-tertiary)',
        cursor: 'pointer', transition: 'all 0.25s',
        fontSize: '0.75rem', fontWeight: 700,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon}
        <span>{label}</span>
      </div>
      
      {/* Toggle Switch */}
      <div style={{ 
        width: 28, height: 14, borderRadius: 99, position: 'relative',
        background: isActive ? '#10b981' : 'var(--border)',
        transition: 'background 0.25s',
      }}>
        <div style={{ 
          position: 'absolute', top: 2, left: isActive ? 14 : 2,
          width: 10, height: 10, borderRadius: '50%',
          background: '#fff', transition: 'left 0.25s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        }} />
      </div>
    </button>
  );
}
