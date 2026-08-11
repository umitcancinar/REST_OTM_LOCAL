'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Ban,
  CheckCircle2,
  Clock3,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldX,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import {
  licenseAdminApi,
  type LicenseRecord,
  type LicenseStatus,
} from '@/lib/license-admin-api';
import { useToast } from '@/components/ui/Toast';
import styles from './page.module.css';

interface TenantOption {
  id: string;
  name: string;
  slug: string;
  isActive?: boolean;
}

const FEATURES = [
  ['pos', 'Kasa & POS'],
  ['waiter', 'Garson'],
  ['kitchen', 'Mutfak'],
  ['inventory', 'Stok'],
  ['reports', 'Raporlar'],
  ['takeaway', 'Paket servis'],
  ['printer', 'Yazdırma'],
] as const;

const STATUS_LABEL: Record<LicenseStatus, string> = {
  PENDING: 'Aktivasyon bekliyor',
  ACTIVE: 'Aktif',
  SUSPENDED: 'Askıda',
  REVOKED: 'İptal edildi',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' }).format(new Date(value));
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function LicensesPage() {
  const toast = useToast();
  const [licenses, setLicenses] = useState<LicenseRecord[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState('');
  const [actingId, setActingId] = useState('');
  const [form, setForm] = useState({
    tenantId: '',
    durationDays: 365,
    graceDays: 7,
    features: FEATURES.map(([key]) => key) as string[],
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [licenseResult, tenantResult] = await Promise.all([
        licenseAdminApi.list({ page: 1, limit: 100 }),
        api.get('/tenants') as Promise<TenantOption[]>,
      ]);
      setLicenses(licenseResult.items);
      setTenants(Array.isArray(tenantResult) ? tenantResult : []);
    } catch (loadError) {
      setError(errorMessage(loadError, 'Lisans kayıtları yüklenemedi.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('tr-TR');
    if (!normalized) return licenses;
    return licenses.filter((license) => [
      license.restaurantName,
      license.tenantSlug,
      license.keyMasked,
      license.hardwareIdShort,
    ].some((value) => value?.toLocaleLowerCase('tr-TR').includes(normalized)));
  }, [licenses, query]);

  const counts = useMemo(() => licenses.reduce<Record<LicenseStatus, number>>((result, item) => {
    result[item.status] += 1;
    return result;
  }, { PENDING: 0, ACTIVE: 0, SUSPENDED: 0, REVOKED: 0 }), [licenses]);

  function toggleFeature(feature: string) {
    setForm((current) => ({
      ...current,
      features: current.features.includes(feature)
        ? current.features.filter((item) => item !== feature)
        : [...current.features, feature],
    }));
  }

  function closeCreate() {
    if (creating) return;
    setCreateOpen(false);
    setCreatedKey('');
    setForm({
      tenantId: '',
      durationDays: 365,
      graceDays: 7,
      features: FEATURES.map(([key]) => key),
      notes: '',
    });
  }

  async function createLicense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.tenantId) {
      toast.error('Önce restoran seçin.');
      return;
    }
    setCreating(true);
    try {
      const result = await licenseAdminApi.create({
        tenantId: form.tenantId,
        durationDays: form.durationDays,
        graceDays: form.graceDays,
        features: form.features,
        notes: form.notes.trim() || undefined,
      });
      setLicenses((items) => [result.license, ...items]);
      setCreatedKey(result.key);
      toast.success('Lisans üretildi. Anahtar yalnız şimdi gösteriliyor.');
    } catch (createError) {
      toast.error(errorMessage(createError, 'Lisans üretilemedi.'));
    } finally {
      setCreating(false);
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(createdKey);
      toast.success('Lisans anahtarı kopyalandı.');
    } catch {
      toast.error('Anahtar panoya kopyalanamadı.');
    }
  }

  function replaceLicense(next: LicenseRecord) {
    setLicenses((items) => items.map((item) => item.id === next.id ? next : item));
  }

  async function runAction(license: LicenseRecord, action: 'extend' | 'suspend' | 'resume' | 'revoke') {
    if (action === 'revoke' && !window.confirm(`${license.restaurantName} lisansı kalıcı olarak iptal edilsin mi?`)) return;
    if (action === 'suspend' && !window.confirm(`${license.restaurantName} lisansı askıya alınsın mı?`)) return;

    let days = 0;
    if (action === 'extend') {
      const value = window.prompt('Kaç gün uzatılsın?', '365');
      if (value === null) return;
      days = Number(value);
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        toast.error('Süre 1–3650 gün arasında tam sayı olmalı.');
        return;
      }
    }

    setActingId(license.id);
    try {
      const next = action === 'extend'
        ? await licenseAdminApi.extend(license.id, days)
        : action === 'suspend'
          ? await licenseAdminApi.suspend(license.id)
          : action === 'resume'
            ? await licenseAdminApi.resume(license.id)
            : await licenseAdminApi.revoke(license.id);
      replaceLicense(next);
      toast.success('Lisans durumu güncellendi.');
    } catch (actionError) {
      toast.error(errorMessage(actionError, 'İşlem tamamlanamadı.'));
    } finally {
      setActingId('');
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}><KeyRound size={15} /> CONTROL API</span>
          <h1>Lisans Yönetimi</h1>
          <p>Restoran lisanslarını üretin, cihaz durumunu izleyin ve yaşam döngüsünü yönetin.</p>
        </div>
        <button className={styles.primary} type="button" onClick={() => setCreateOpen(true)}>
          <Plus size={18} /> Yeni lisans üret
        </button>
      </header>

      <section className={styles.stats} aria-label="Lisans özeti">
        <div><Activity /><span>Aktif</span><strong>{counts.ACTIVE}</strong></div>
        <div><Clock3 /><span>Bekliyor</span><strong>{counts.PENDING}</strong></div>
        <div><Ban /><span>Askıda</span><strong>{counts.SUSPENDED}</strong></div>
        <div><ShieldX /><span>İptal</span><strong>{counts.REVOKED}</strong></div>
      </section>

      <section className={styles.directory}>
        <div className={styles.toolbar}>
          <label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Restoran, anahtar veya cihaz ara…" /></label>
          <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> Yenile</button>
        </div>

        {error && <div className={styles.error}>{error}</div>}
        {loading ? (
          <div className={styles.empty}><Loader2 className={styles.spin} /> Lisanslar yükleniyor…</div>
        ) : visible.length === 0 ? (
          <div className={styles.empty}>Henüz lisans kaydı yok.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Restoran</th><th>Durum</th><th>Bitiş</th><th>Cihaz</th><th>Anahtar</th><th>İşlemler</th></tr></thead>
              <tbody>{visible.map((license) => (
                <tr key={license.id}>
                  <td><strong>{license.restaurantName}</strong><small>{license.tenantSlug}</small></td>
                  <td><span className={`${styles.badge} ${styles[`status${license.status}`]}`}>{STATUS_LABEL[license.status]}</span></td>
                  <td>{formatDate(license.expiresAt)}<small>{license.graceDays} gün çevrimdışı tolerans</small></td>
                  <td>{license.hardwareIdShort || 'Bağlanmadı'}</td>
                  <td><code>{license.keyMasked}</code></td>
                  <td>
                    <div className={styles.actions}>
                      <button disabled={actingId === license.id || license.status === 'REVOKED'} onClick={() => void runAction(license, 'extend')}>Uzat</button>
                      {license.status === 'SUSPENDED' ? (
                        <button disabled={actingId === license.id} onClick={() => void runAction(license, 'resume')}>Devam</button>
                      ) : license.status !== 'REVOKED' && (
                        <button disabled={actingId === license.id} onClick={() => void runAction(license, 'suspend')}>Askıya al</button>
                      )}
                      {license.status !== 'REVOKED' && <button className={styles.danger} disabled={actingId === license.id} onClick={() => void runAction(license, 'revoke')}>İptal</button>}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {createOpen && (
        <div className={styles.overlay} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeCreate()}>
          <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="license-title">
            <button className={styles.close} type="button" onClick={closeCreate} aria-label="Kapat"><X size={19} /></button>
            {createdKey ? (
              <div className={styles.keyResult}>
                <CheckCircle2 size={42} />
                <h2 id="license-title">Lisans hazır</h2>
                <p>Tam anahtar daha sonra tekrar gösterilmeyecek. Güvenli biçimde müşteriye teslim edin.</p>
                <code>{createdKey}</code>
                <button className={styles.primary} type="button" onClick={() => void copyKey()}><Copy size={17} /> Kopyala</button>
                <button className={styles.secondary} type="button" onClick={closeCreate}>Tamam</button>
              </div>
            ) : (
              <form onSubmit={createLicense}>
                <h2 id="license-title">Yeni lisans üret</h2>
                <p>Lisans ilk aktivasyonda tek bir cihaz kimliğine bağlanacaktır.</p>
                <label>Restoran<select required value={form.tenantId} onChange={(event) => setForm((current) => ({ ...current, tenantId: event.target.value }))}>
                  <option value="">Restoran seçin</option>
                  {tenants.filter((tenant) => tenant.isActive !== false).map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name} ({tenant.slug})</option>)}
                </select></label>
                <div className={styles.row}>
                  <label>Süre (gün)<input type="number" min={1} max={3650} required value={form.durationDays} onChange={(event) => setForm((current) => ({ ...current, durationDays: Number(event.target.value) }))} /></label>
                  <label>Çevrimdışı tolerans<input type="number" min={0} max={30} required value={form.graceDays} onChange={(event) => setForm((current) => ({ ...current, graceDays: Number(event.target.value) }))} /></label>
                </div>
                <fieldset><legend>Aktif modüller</legend><div className={styles.features}>{FEATURES.map(([key, label]) => (
                  <label key={key}><input type="checkbox" checked={form.features.includes(key)} onChange={() => toggleFeature(key)} /> {label}</label>
                ))}</div></fieldset>
                <label>Not<textarea maxLength={2000} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                <div className={styles.modalActions}>
                  <button className={styles.secondary} type="button" onClick={closeCreate}>Vazgeç</button>
                  <button className={styles.primary} type="submit" disabled={creating}>{creating ? <Loader2 className={styles.spin} size={17} /> : <KeyRound size={17} />} Lisansı üret</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
