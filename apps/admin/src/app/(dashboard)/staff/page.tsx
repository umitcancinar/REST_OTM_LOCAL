'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import {
  UserCheck, UserPlus, Mail, Lock, Shield, Clock,
  Edit2, Trash2, X, Loader2, CheckCircle, XCircle,
  ChevronDown, Eye, EyeOff, User, Key
} from 'lucide-react';

const ROLE_MAP: Record<string, { label: string; color: string; bg: string }> = {
  OWNER:   { label: 'Sahip',    color: '#7C3AED', bg: '#EDE9FE' },
  ADMIN:   { label: 'Yönetici', color: '#1D4ED8', bg: '#DBEAFE' },
  CASHIER: { label: 'Kasiyer',  color: '#B45309', bg: '#FEF3C7' },
  CHEF:    { label: 'Şef',      color: '#065F46', bg: '#D1FAE5' },
  WAITER:  { label: 'Garson',   color: '#0F766E', bg: '#CCFBF1' },
};

const ROLES = ['WAITER', 'CASHIER', 'CHEF', 'ADMIN', 'OWNER'];

function RoleBadge({ role }: { role: string }) {
  const r = ROLE_MAP[role] || { label: role, color: '#64748b', bg: '#F1F5F9' };
  return (
    <span style={{
      fontSize: '0.6875rem', fontWeight: 800, padding: '3px 8px',
      borderRadius: 20, letterSpacing: '0.04em',
      color: r.color, background: r.bg,
    }}>{r.label}</span>
  );
}

type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

type ModalMode = 'create' | 'edit';

export default function StaffPage() {
  const [isSetupSession, setIsSetupSession] = useState(false);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null');
      setIsSetupSession(user?.sessionType === 'local_setup');
    } catch {
      setIsSetupSession(false);
    }
  }, []);

  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [editTarget, setEditTarget] = useState<StaffMember | null>(null);

  // Form state
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'WAITER', pin: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const loadStaff = useCallback(async () => {
    try {
      const data = await api.get('/staff');
      setStaff(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadStaff(); }, [loadStaff]);

  useEffect(() => {
    if (showModal) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [showModal]);

  const openCreate = () => {
    setModalMode('create');
    setEditTarget(null);
    setForm({ name: '', email: '', password: '', role: 'WAITER', pin: '' });
    setFormError('');
    setShowPassword(false);
    setShowModal(true);
  };

  const openEdit = (member: StaffMember) => {
    setModalMode('edit');
    setEditTarget(member);
    setForm({ name: member.name, email: member.email, password: '', role: member.role, pin: '' });
    setFormError('');
    setShowPassword(false);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormLoading(true);
    try {
      const passwordIsWeak = form.password.length > 0 && (
        form.password.length < 12
        || !/[a-z]/.test(form.password)
        || !/[A-Z]/.test(form.password)
        || !/[0-9]/.test(form.password)
        || !/[^A-Za-z0-9]/.test(form.password)
      );
      if (modalMode === 'create') {
        if (!form.password || passwordIsWeak) {
          setFormError('Şifre en az 12 karakter; büyük-küçük harf, rakam ve özel karakter içermelidir.');
          return;
        }
        const created = await api.post('/staff', { name: form.name, email: form.email, password: form.password, role: form.role, pin: form.pin || undefined });
        if (isSetupSession && created?.setupCompleted) {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          window.location.replace('/?setup=complete');
          return;
        }
      } else if (editTarget) {
        if (passwordIsWeak) {
          setFormError('Yeni şifre en az 12 karakter; büyük-küçük harf, rakam ve özel karakter içermelidir.');
          return;
        }
        const payload: any = { name: form.name, email: form.email, role: form.role };
        if (form.password) payload.password = form.password;
        if (form.pin !== undefined) payload.pin = form.pin;
        await api.patch(`/staff/${editTarget.id}`, payload);
      }
      setShowModal(false);
      await loadStaff();
    } catch (err: any) {
      setFormError(err.message || 'Bir hata oluştu.');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    setDeleteLoading(true);
    try {
      await api.delete(`/staff/${id}`);
      setDeleteConfirm(null);
      await loadStaff();
    } catch (err: any) {
      alert(err.message || 'Personel silinemedi.');
    } finally {
      setDeleteLoading(false);
    }
  };

  const activeStaff = staff.filter(s => s.isActive);
  const inactiveStaff = staff.filter(s => !s.isActive);

  return (
    <div className="animate-fade-in" style={{ padding: '0 0 48px' }}>

      {isSetupSession && (
        <div className="card" style={{ marginBottom: 24, padding: 20, border: '1px solid #f59e0b', background: '#fffbeb' }}>
          <strong style={{ display: 'block', color: '#92400e', marginBottom: 6 }}>İlk kurulum oturumu</strong>
          <span style={{ color: '#78350f', fontSize: '0.875rem' }}>
            Önce gerçek bir Yönetici veya Sahip hesabı oluşturun. Bu geçici oturum 15 dakika içinde veya yönetici oluşur oluşmaz kapanır. Garson hesaplarını yönetici hesabıyla giriş yaptıktan sonra da ekleyebilirsiniz.
          </span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 6 }}>
            Personeller
          </h1>
          <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
            {activeStaff.length} aktif personel
            {inactiveStaff.length > 0 && ` · ${inactiveStaff.length} pasif`}
          </p>
        </div>
        <button
          id="add-staff-btn"
          onClick={openCreate}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--accent)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-xl)',
            padding: '12px 22px', fontWeight: 800, fontSize: '0.9375rem',
            cursor: 'pointer', boxShadow: 'var(--shadow-glow)',
            transition: 'all 0.2s', letterSpacing: '-0.01em',
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-1px)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'none')}
        >
          <UserPlus size={18} strokeWidth={2.5} />
          Personel Ekle
        </button>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 32 }}>
        {Object.entries(ROLE_MAP).map(([role, meta]) => {
          const count = staff.filter(s => s.role === role && s.isActive).length;
          return (
            <div key={role} className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UserCheck size={18} color={meta.color} />
              </div>
              <div>
                <div style={{ fontSize: '1.5rem', fontWeight: 900, lineHeight: 1, color: 'var(--text-primary)' }}>{count}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, marginTop: 2 }}>{meta.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Staff Grid */}
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader2 size={32} className="animate-spin" color="var(--accent)" />
        </div>
      ) : activeStaff.length === 0 ? (
        <div className="card" style={{ padding: '80px 24px', textAlign: 'center' }}>
          <UserCheck size={56} strokeWidth={1} style={{ margin: '0 auto 16px', opacity: 0.25, display: 'block' }} />
          <h3 style={{ fontWeight: 800, fontSize: '1.125rem', marginBottom: 8 }}>Henüz personel eklenmedi</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 24 }}>
            Garson, kasiyer veya şef ekleyerek başlayın.
          </p>
          <button onClick={openCreate} className="btn btn-primary" style={{ margin: '0 auto' }}>
            <UserPlus size={16} /> İlk Personeli Ekle
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {activeStaff.map(member => (
            <StaffCard
              key={member.id}
              member={member}
              onEdit={() => openEdit(member)}
              onDelete={() => setDeleteConfirm(member.id)}
            />
          ))}
        </div>
      )}

      {/* Inactive section */}
      {inactiveStaff.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 16, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Pasif Personeller ({inactiveStaff.length})
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {inactiveStaff.map(member => (
              <StaffCard
                key={member.id}
                member={member}
                onEdit={() => openEdit(member)}
                onDelete={() => setDeleteConfirm(member.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {mounted && showModal && createPortal(
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
          onClick={() => setShowModal(false)}
        >
          <div
            className="modal-box"
            style={{ maxWidth: 480, padding: 0, width: '100%', maxHeight: '95vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{
              padding: '24px 28px 20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: 'var(--gradient-accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {modalMode === 'create' ? <UserPlus size={20} color="#fff" /> : <Edit2 size={18} color="#fff" />}
                </div>
                <div>
                  <h2 style={{ fontWeight: 900, fontSize: '1.125rem', color: 'var(--text-primary)', lineHeight: 1.2 }}>
                    {modalMode === 'create' ? 'Yeni Personel Ekle' : 'Personeli Düzenle'}
                  </h2>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                    {modalMode === 'create' ? 'Garson paneline giriş bilgileri oluşturulur' : 'Bilgileri güncelle'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 6, borderRadius: 8 }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto' }}>

              {/* Name */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Ad Soyad *
                </label>
                <div style={{ position: 'relative' }}>
                  <User size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    className="input"
                    style={{ paddingLeft: 40 }}
                    placeholder="Ahmet Yıldız"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    required
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  E-posta (Kullanıcı Adı) *
                </label>
                <div style={{ position: 'relative' }}>
                  <Mail size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    className="input"
                    style={{ paddingLeft: 40 }}
                    type="email"
                    placeholder="garson@restoran.com"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    required
                  />
                </div>
              </div>

              {/* Role */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Rol *
                </label>
                <div style={{ position: 'relative' }}>
                  <Shield size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <ChevronDown size={16} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                  <select
                    className="input"
                    style={{ paddingLeft: 40, paddingRight: 36, appearance: 'none', cursor: 'pointer' }}
                    value={form.role}
                    onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  >
                    {ROLES.map(r => (
                      <option key={r} value={r}>{ROLE_MAP[r]?.label || r}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Password */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  {modalMode === 'create' ? 'Şifre *' : 'Yeni Şifre (boş bırakılırsa değişmez)'}
                </label>
                <div style={{ position: 'relative' }}>
                  <Lock size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    className="input"
                    style={{ paddingLeft: 40, paddingRight: 44 }}
                    type={showPassword ? 'text' : 'password'}
                    placeholder={modalMode === 'create' ? 'En az 12 karakter' : '••••••••'}
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    required={modalMode === 'create'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* PIN */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  PIN Kodu <span style={{ fontWeight: 400, opacity: 0.7 }}>(opsiyonel, 4–8 haneli)</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <Key size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    className="input"
                    style={{ paddingLeft: 40 }}
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="1234"
                    value={form.pin}
                    onChange={e => setForm(f => ({ ...f, pin: e.target.value }))}
                    maxLength={8}
                  />
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 6 }}>
                  PIN ile garson paneline hızlı giriş yapılabilir.
                </p>
              </div>

              {formError && (
                <div style={{
                  background: 'var(--danger-bg)', color: 'var(--danger)',
                  border: '1px solid var(--danger-border)',
                  borderRadius: 'var(--radius-sm)', padding: '12px 16px',
                  fontSize: '0.8125rem', fontWeight: 500,
                }}>
                  {formError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flex: 2 }}
                  disabled={formLoading}
                >
                  {formLoading
                    ? <Loader2 size={16} className="animate-spin" />
                    : modalMode === 'create' ? <><UserPlus size={16} /> Personel Ekle</> : <><CheckCircle size={16} /> Kaydet</>
                  }
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Confirm Modal */}
      {mounted && deleteConfirm && createPortal(
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 100000,
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="modal-box"
            style={{ maxWidth: 400, padding: 28, textAlign: 'center' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Trash2 size={24} color="#B91C1C" />
            </div>
            <h3 style={{ fontWeight: 900, fontSize: '1.125rem', marginBottom: 8 }}>Personeli Sil</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 24, lineHeight: 1.6 }}>
              Bu personeli silmek istediğinize emin misiniz? (Eski siparişlerdeki isim kayıtları korunacaktır).
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setDeleteConfirm(null)} className="btn btn-ghost" style={{ flex: 1 }}>İptal</button>
              <button
                onClick={() => handleDeactivate(deleteConfirm)}
                disabled={deleteLoading}
                style={{ flex: 1, background: '#EF4444', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', padding: '10px 0', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                {deleteLoading ? <Loader2 size={16} className="animate-spin" /> : <><Trash2 size={16} /> Sil</>}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}

function StaffCard({
  member, onEdit, onDelete
}: {
  member: StaffMember;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const role = ROLE_MAP[member.role] || { label: member.role, color: '#64748b', bg: '#F1F5F9' };
  const initials = member.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div
      className="card hover-pop"
      style={{
        padding: '20px 24px',
        display: 'flex', flexDirection: 'column', gap: 16,
        opacity: member.isActive ? 1 : 0.6,
        transition: 'all 0.2s',
        position: 'relative', overflow: 'hidden',
      }}
    >
      {/* Left accent bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, bottom: 0, width: 4,
        background: member.isActive ? role.color : '#CBD5E1',
        borderRadius: '4px 0 0 4px',
      }} />

      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {/* Avatar */}
        <div style={{
          width: 48, height: 48, borderRadius: 14,
          background: `linear-gradient(135deg, ${role.color}33, ${role.color}99)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 900, fontSize: '1rem', color: role.color, flexShrink: 0,
          border: `2px solid ${role.color}44`,
        }}>
          {initials}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {member.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RoleBadge role={member.role} />
            {!member.isActive && (
              <span style={{ fontSize: '0.6875rem', fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#FEE2E2', color: '#B91C1C' }}>Pasif</span>
            )}
          </div>
        </div>
      </div>

      {/* Email row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
        <Mail size={13} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.email}</span>
      </div>

      {/* Last Login */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
        <Clock size={12} />
        <span>
          {member.lastLoginAt
            ? `Son giriş: ${new Date(member.lastLoginAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}`
            : 'Henüz giriş yapılmadı'}
        </span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <button
          onClick={onEdit}
          className="btn btn-ghost"
          style={{ flex: 1, fontSize: '0.8125rem', padding: '8px 0', gap: 6 }}
        >
          <Edit2 size={14} /> Düzenle
        </button>
        <button
          onClick={onDelete}
          className="btn btn-ghost"
          style={{
            flex: 1, fontSize: '0.8125rem', padding: '8px 0', gap: 6,
            color: '#DC2626',
          }}
        >
          <Trash2 size={14} /> Sil
        </button>
      </div>
    </div>
  );
}
