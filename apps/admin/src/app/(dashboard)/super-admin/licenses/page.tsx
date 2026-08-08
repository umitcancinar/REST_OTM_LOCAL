'use client';

import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  Loader2,
  MoreHorizontal,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  FormEvent,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Portal from '@/components/ui/Portal';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import {
  CreateLicenseInput,
  LicenseRecord,
  licenseAdminApi,
} from '@/lib/licenseAdminApi';
import styles from './page.module.css';

type TenantOption = { id: string; name: string; slug?: string };
type Lifecycle = 'PENDING' | 'ACTIVE' | 'EXPIRING' | 'GRACE' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED';
type Filter = 'ALL' | Lifecycle;
type CriticalAction = 'suspend' | 'revoke' | 'reset' | 'rebind';

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_DAYS = 14;

const FEATURES = [
  { key: 'pos', label: 'Kasa & POS', description: 'Ödeme ve adisyon akışı' },
  { key: 'waiter', label: 'Garson', description: 'Yerel ağdan sipariş girişi' },
  { key: 'kitchen', label: 'Mutfak', description: 'Hazırlık ve mutfak ekranı' },
  { key: 'inventory', label: 'Stok', description: 'Stok ve reçete takibi' },
  { key: 'reports', label: 'Raporlar', description: 'Satış ve operasyon analizi' },
  { key: 'takeaway', label: 'Paket servis', description: 'Gel-al ve paket siparişler' },
  { key: 'printer', label: 'Yazdırma', description: 'Fiş ve mutfak yazıcıları' },
] as const;

const DEFAULT_FEATURES = FEATURES.map((feature) => feature.key);

const STATUS_LABELS: Record<Lifecycle, string> = {
  PENDING: 'Aktivasyon bekliyor',
  ACTIVE: 'Aktif',
  EXPIRING: 'Sona yakın',
  GRACE: 'Ek süre',
  EXPIRED: 'Süresi doldu',
  SUSPENDED: 'Askıya alındı',
  REVOKED: 'İptal edildi',
};

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'Tümü' },
  { value: 'ACTIVE', label: 'Aktif' },
  { value: 'EXPIRING', label: 'Sona yakın' },
  { value: 'GRACE', label: 'Ek sürede' },
  { value: 'EXPIRED', label: 'Süresi doldu' },
  { value: 'SUSPENDED', label: 'Askıya alındı' },
  { value: 'REVOKED', label: 'İptal edildi' },
  { value: 'PENDING', label: 'Aktivasyon bekliyor' },
];

function lifecycleOf(license: LicenseRecord, now = Date.now()): Lifecycle {
  if (license.status === 'SUSPENDED') return 'SUSPENDED';
  if (license.status === 'REVOKED') return 'REVOKED';

  const expiry = new Date(license.expiresAt).getTime();
  if (Number.isFinite(expiry) && expiry <= now) return 'EXPIRED';
  if (license.status === 'PENDING') return 'PENDING';
  if (license.lastHeartbeatAt) {
    const offlineFor = now - new Date(license.lastHeartbeatAt).getTime();
    if (offlineFor > 2 * 60 * 60 * 1000) {
      return offlineFor <= license.graceDays * DAY_MS ? 'GRACE' : 'EXPIRED';
    }
  }
  if (expiry - now <= EXPIRING_DAYS * DAY_MS) return 'EXPIRING';
  return 'ACTIVE';
}

function formatDate(value: string | null, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('tr-TR', withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

function remainingLabel(license: LicenseRecord, lifecycle: Lifecycle) {
  if (license.lastHeartbeatAt && lifecycle === 'GRACE') {
    const graceEnd = new Date(license.lastHeartbeatAt).getTime() + license.graceDays * DAY_MS;
    const graceDaysLeft = Math.max(0, Math.ceil((graceEnd - Date.now()) / DAY_MS));
    return `Çevrimdışı · ${graceDaysLeft} gün pencere`;
  }
  const diff = new Date(license.expiresAt).getTime() - Date.now();
  if (lifecycle === 'EXPIRED' && diff > 0) return 'Çevrimdışı pencere aşıldı';
  const days = Math.ceil(Math.abs(diff) / DAY_MS);
  if (diff < 0) return `${days} gün önce doldu`;
  if (days === 0) return 'Bugün doluyor';
  return `${days} gün kaldı`;
}

function heartbeatState(value: string | null) {
  if (!value) return { live: false, label: 'Henüz yoklama yok' };
  const hours = (Date.now() - new Date(value).getTime()) / (60 * 60 * 1000);
  return {
    live: hours <= 2,
    label: hours <= 2 ? 'Son 2 saatte çevrimiçi' : formatDate(value, true),
  };
}

function normalizeError(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message) return fallback;
  if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
    return 'Lisans servisine bağlanılamadı. Ağ ve sunucu durumunu kontrol edin.';
  }
  return error.message;
}

function replaceLicense(items: LicenseRecord[], next: LicenseRecord) {
  return items.map((item) => item.id === next.id ? next : item);
}

function Dialog({
  open,
  onClose,
  titleId,
  descriptionId,
  initialFocusRef,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  titleId: string;
  descriptionId?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusableSelector = [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const focusTarget = initialFocusRef?.current
      ?? dialog?.querySelector<HTMLElement>(focusableSelector)
      ?? dialog;
    window.requestAnimationFrame(() => focusTarget?.focus());

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [initialFocusRef, onClose, open]);

  if (!open) return null;

  return (
    <Portal>
      <div
        className={styles.backdrop}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          ref={dialogRef}
          className={`${styles.dialog} ${className ?? ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
        >
          {children}
        </div>
      </div>
    </Portal>
  );
}

function StatusBadge({ lifecycle }: { lifecycle: Lifecycle }) {
  return (
    <span className={`${styles.statusBadge} ${styles[`status${lifecycle}`]}`}>
      <span aria-hidden="true" />
      {STATUS_LABELS[lifecycle]}
    </span>
  );
}

export default function LicenseManagementPage() {
  const toast = useToast();
  const [licenses, setLicenses] = useState<LicenseRecord[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [now, setNow] = useState(() => Date.now());

  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState(1);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdKey, setCreatedKey] = useState('');
  const [showCreatedKey, setShowCreatedKey] = useState(false);
  const [createdLicenseName, setCreatedLicenseName] = useState('');
  const [createForm, setCreateForm] = useState({
    tenantId: '',
    durationDays: 365,
    graceDays: 7,
    features: [...DEFAULT_FEATURES] as string[],
    notes: '',
  });

  const [editing, setEditing] = useState<LicenseRecord | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const [editForm, setEditForm] = useState({ graceDays: 7, features: [] as string[], notes: '', extendDays: 0 });

  const [critical, setCritical] = useState<{ type: CriticalAction; license: LicenseRecord } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [hardwareId, setHardwareId] = useState('');
  const [hardwareIdShort, setHardwareIdShort] = useState('');
  const [acting, setActing] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const createTenantRef = useRef<HTMLSelectElement>(null);
  const createdKeyHeadingRef = useRef<HTMLHeadingElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [licenseResult, tenantResult] = await Promise.all([
        licenseAdminApi.list({ page: 1, limit: 100 }),
        api.get('/tenants') as Promise<TenantOption[]>,
      ]);
      setLicenses(licenseResult.items);
      setTotal(licenseResult.total);
      setTenants(Array.isArray(tenantResult) ? tenantResult : []);
    } catch (error) {
      setLoadError(normalizeError(error, 'Lisanslar yüklenemedi.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [loadData]);

  useEffect(() => {
    if (!createdKey) return;
    const frame = window.requestAnimationFrame(() => createdKeyHeadingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [createdKey]);

  useEffect(() => {
    if (!createdKey || !showCreatedKey) return;
    const hideKey = () => setShowCreatedKey(false);
    const timer = window.setTimeout(hideKey, 15_000);
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') hideKey();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [createdKey, showCreatedKey]);

  const stats = useMemo(() => {
    const counts: Record<Lifecycle, number> = {
      PENDING: 0,
      ACTIVE: 0,
      EXPIRING: 0,
      GRACE: 0,
      EXPIRED: 0,
      SUSPENDED: 0,
      REVOKED: 0,
    };
    for (const license of licenses) counts[lifecycleOf(license, now)] += 1;
    return counts;
  }, [licenses, now]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR');
    return licenses
      .filter((license) => filter === 'ALL' || lifecycleOf(license, now) === filter)
      .filter((license) => {
        if (!normalizedQuery) return true;
        return [
          license.restaurantName,
          license.keyMasked,
          license.hardwareIdShort,
          license.lastHeartbeatIp,
        ].some((value) => value?.toLocaleLowerCase('tr-TR').includes(normalizedQuery));
      })
      .sort((a, b) => {
        if (a.suspiciousCount !== b.suspiciousCount) return b.suspiciousCount - a.suspiciousCount;
        return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
      });
  }, [filter, licenses, now, query]);

  const closeCreate = useCallback(() => {
    if (creating) return;
    setCreateOpen(false);
    setCreatedKey('');
    setShowCreatedKey(false);
    setCreatedLicenseName('');
    setCreateError('');
    setCreateStep(1);
    setCreateForm({
      tenantId: '',
      durationDays: 365,
      graceDays: 7,
      features: [...DEFAULT_FEATURES],
      notes: '',
    });
  }, [creating]);

  const closeEdit = useCallback(() => {
    if (!savingEdit) setEditing(null);
  }, [savingEdit]);

  const closeCritical = useCallback(() => {
    if (acting) return;
    setCritical(null);
    setConfirmation('');
    setHardwareId('');
    setHardwareIdShort('');
    setActionError('');
  }, [acting]);

  function toggleFeature(key: string, target: 'create' | 'edit') {
    if (target === 'create') {
      setCreateForm((current) => ({
        ...current,
        features: current.features.includes(key)
          ? current.features.filter((feature) => feature !== key)
          : [...current.features, key],
      }));
      return;
    }
    setEditForm((current) => ({
      ...current,
      features: current.features.includes(key)
        ? current.features.filter((feature) => feature !== key)
        : [...current.features, key],
    }));
  }

  function nextCreateStep() {
    setCreateError('');
    if (createStep === 1 && !createForm.tenantId) {
      setCreateError('Lisansın bağlanacağı restoranı seçin.');
      return;
    }
    if (createStep === 2 && (createForm.durationDays < 1 || createForm.durationDays > 3650)) {
      setCreateError('Lisans süresi 1–3650 gün arasında olmalı.');
      return;
    }
    if (createStep === 2 && (createForm.graceDays < 0 || createForm.graceDays > 30)) {
      setCreateError('İnternetsiz çalışma süresi 0–30 gün arasında olmalı.');
      return;
    }
    setCreateStep((step) => Math.min(3, step + 1));
  }

  async function createLicense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createStep < 3) {
      nextCreateStep();
      return;
    }
    setCreating(true);
    setCreateError('');
    const body: CreateLicenseInput = {
      tenantId: createForm.tenantId,
      durationDays: createForm.durationDays,
      graceDays: createForm.graceDays,
      features: createForm.features,
      notes: createForm.notes.trim() || undefined,
    };
    try {
      const result = await licenseAdminApi.create(body);
      setLicenses((items) => [result.license, ...items]);
      setTotal((value) => value + 1);
      setCreatedLicenseName(result.license.restaurantName);
      setCreatedKey(result.key);
      setShowCreatedKey(false);
      toast.success('Lisans güvenle üretildi. Anahtarı şimdi teslim edin.');
    } catch (error) {
      setCreateError(normalizeError(error, 'Lisans üretilemedi.'));
    } finally {
      setCreating(false);
    }
  }

  function openEditor(license: LicenseRecord) {
    setEditError('');
    setEditForm({
      graceDays: license.graceDays,
      features: [...license.features],
      notes: license.notes ?? '',
      extendDays: 0,
    });
    setEditing(license);
  }

  async function saveLicense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    if (editForm.graceDays < 0 || editForm.graceDays > 30) {
      setEditError('İnternetsiz çalışma süresi 0–30 gün arasında olmalı.');
      return;
    }
    if (editForm.extendDays < 0 || editForm.extendDays > 3650) {
      setEditError('Uzatma süresi 0–3650 gün arasında olmalı.');
      return;
    }
    setSavingEdit(true);
    setEditError('');
    try {
      let next = await licenseAdminApi.update(editing.id, {
        graceDays: editForm.graceDays,
        features: editForm.features,
        notes: editForm.notes.trim(),
      });
      if (editForm.extendDays > 0) next = await licenseAdminApi.extend(editing.id, editForm.extendDays);
      setLicenses((items) => replaceLicense(items, next));
      setEditing(null);
      toast.success('Lisans ayarları güncellendi.');
    } catch (error) {
      setEditError(normalizeError(error, 'Lisans güncellenemedi.'));
    } finally {
      setSavingEdit(false);
    }
  }

  function openCritical(type: CriticalAction, license: LicenseRecord) {
    setCritical({ type, license });
    setConfirmation('');
    setHardwareId('');
    setHardwareIdShort('');
    setActionError('');
  }

  async function resumeLicense(license: LicenseRecord) {
    setResumingId(license.id);
    try {
      const next = await licenseAdminApi.resume(license.id);
      setLicenses((items) => replaceLicense(items, next));
      toast.success('Lisans askıdan çıkarıldı.');
    } catch (error) {
      toast.error(normalizeError(error, 'Lisans askıdan çıkarılamadı. Süresini kontrol edin.'));
    } finally {
      setResumingId(null);
    }
  }

  const requiredPhrase = critical
    ? ({
        suspend: 'ASKIYA AL',
        revoke: 'KALICI İPTAL',
        reset: 'CİHAZI SIFIRLA',
        rebind: 'YENİDEN BAĞLA',
      } as const)[critical.type]
    : '';

  async function runCriticalAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!critical || confirmation !== requiredPhrase) return;
    if (critical.type === 'rebind' && !/^[a-f0-9]{64}$/i.test(hardwareId.trim())) {
      setActionError('Donanım kimliği 64 karakterlik SHA-256 özeti olmalı.');
      return;
    }
    setActing(true);
    setActionError('');
    try {
      let next: LicenseRecord;
      if (critical.type === 'suspend') next = await licenseAdminApi.suspend(critical.license.id);
      else if (critical.type === 'revoke') next = await licenseAdminApi.revoke(critical.license.id);
      else if (critical.type === 'reset') next = await licenseAdminApi.resetActivation(critical.license.id);
      else next = await licenseAdminApi.rebind(critical.license.id, {
        hardwareId: hardwareId.trim().toLowerCase(),
        hardwareIdShort: hardwareIdShort.trim() || undefined,
      });
      setLicenses((items) => replaceLicense(items, next));
      closeCritical();
      toast.success(
        critical.type === 'suspend' ? 'Lisans askıya alındı.'
          : critical.type === 'revoke' ? 'Lisans kalıcı olarak iptal edildi.'
            : critical.type === 'reset' ? 'Cihaz bağı sıfırlandı.'
              : 'Lisans yeni cihaza bağlandı.',
      );
    } catch (error) {
      setActionError(normalizeError(error, 'İşlem tamamlanamadı.'));
    } finally {
      setActing(false);
    }
  }

  async function copyKey() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      toast.success('Lisans anahtarı panoya kopyalandı.');
    } catch {
      toast.error('Anahtar kopyalanamadı. Elle seçip kopyalayın.');
    }
  }

  const selectedTenant = tenants.find((tenant) => tenant.id === createForm.tenantId);
  const maskedCreatedKey = createdKey
    ? `${createdKey.slice(0, 5)}••••-••••-••••-${createdKey.slice(-4)}`
    : '';

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroOrbit} aria-hidden="true"><span /><span /><span /></div>
        <div className={styles.breadcrumb}>
          <Link href="/super-admin"><ArrowLeft size={14} /> Sistem yönetimi</Link>
          <span aria-hidden="true">/</span>
          <span>Lisans kasası</span>
        </div>
        <div className={styles.heroContent}>
          <div>
            <span className={styles.eyebrow}><ShieldCheck size={14} /> BULUT LİSANS MERKEZİ</span>
            <h1>Lisansların <em>nabzı.</em></h1>
            <p>Kurulum anahtarlarını üretin, süre ve özellikleri yönetin; cihaz bağını ve son yoklamayı güvenle izleyin.</p>
          </div>
          <button className={styles.primaryButton} type="button" onClick={() => setCreateOpen(true)}>
            <Plus size={17} /> Yeni lisans üret
          </button>
        </div>
        <div className={styles.heroMeta}>
          <span><i className={styles.liveDot} /> Bulut imza servisi</span>
          <span>{total} kayıt</span>
          <span>Tam anahtarlar saklanmaz</span>
        </div>
      </header>

      <section className={styles.stats} aria-label="Lisans durum özeti">
        <StatCard label="Aktif" value={stats.ACTIVE} icon={<Activity />} tone="active" hint="Sağlıklı ve süresi yeterli" />
        <StatCard label="Sona yakın" value={stats.EXPIRING} icon={<Clock3 />} tone="expiring" hint={`${EXPIRING_DAYS} gün içinde biten`} />
        <StatCard label="Ek sürede" value={stats.GRACE} icon={<WifiOff />} tone="grace" hint="Bitiş sonrası tanınan pencere" />
        <StatCard label="Süresi doldu" value={stats.EXPIRED} icon={<AlertTriangle />} tone="expired" hint="Yenileme veya yoklama bekliyor" />
        <StatCard label="Askıda" value={stats.SUSPENDED} icon={<Ban />} tone="suspended" hint="Geçici olarak durdurulan" />
        <StatCard label="İptal" value={stats.REVOKED} icon={<ShieldAlert />} tone="revoked" hint="Kalıcı erişim iptali" />
      </section>

      <section className={styles.directory}>
        <header className={styles.directoryHeader}>
          <div>
            <span className={styles.eyebrow}>LİSANS DİZİNİ</span>
            <h2>Müşteri kurulumları</h2>
            <p>Şüpheli hareketler öncelikli, yaklaşan bitişler tarih sırasındadır.</p>
          </div>
          <button className={styles.refreshButton} type="button" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw size={15} className={loading ? styles.spinning : ''} /> Yenile
          </button>
        </header>

        <div className={styles.filters}>
          <label className={styles.search}>
            <Search size={17} aria-hidden="true" />
            <span className={styles.srOnly}>Lisanslarda ara</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Restoran, maskeli anahtar, cihaz veya IP ara…"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Aramayı temizle"><X size={14} /></button>
            )}
          </label>
          <label className={styles.filterSelect}>
            <span>Durum</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
              {FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>

        {loadError && (
          <div className={styles.loadError} role="alert">
            <TriangleAlert size={18} />
            <span>{loadError}</span>
            <button type="button" onClick={() => void loadData()}>Tekrar dene</button>
          </div>
        )}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.srOnly}>Müşteri lisansları</caption>
            <thead>
              <tr>
                <th scope="col">Restoran / anahtar</th>
                <th scope="col">Durum</th>
                <th scope="col">Süre</th>
                <th scope="col">Cihaz & yoklama</th>
                <th scope="col">Özellikler</th>
                <th scope="col"><span className={styles.srOnly}>İşlemler</span></th>
              </tr>
            </thead>
            <tbody>
              {loading && !licenses.length
                ? Array.from({ length: 5 }, (_, index) => <SkeletonRow key={index} />)
                : filtered.map((license) => {
                    const lifecycle = lifecycleOf(license, now);
                    const heartbeat = heartbeatState(license.lastHeartbeatAt);
                    return (
                      <tr key={license.id}>
                        <td data-label="Restoran">
                          <div className={styles.restaurantCell}>
                            <span className={styles.restaurantMark}>{license.restaurantName.slice(0, 1).toLocaleUpperCase('tr-TR')}</span>
                            <span>
                              <strong>{license.restaurantName}</strong>
                              <code>{license.keyMasked}</code>
                            </span>
                            {license.suspiciousCount > 0 && (
                              <span className={styles.riskBadge} title="Şüpheli olay sayısı">
                                <ShieldAlert size={12} /> {license.suspiciousCount}
                              </span>
                            )}
                          </div>
                        </td>
                        <td data-label="Durum"><StatusBadge lifecycle={lifecycle} /></td>
                        <td data-label="Süre">
                          <div className={styles.dateCell}>
                            <strong>{formatDate(license.expiresAt)}</strong>
                            <span>{remainingLabel(license, lifecycle)} · {license.graceDays} gün ek süre</span>
                          </div>
                        </td>
                        <td data-label="Cihaz & yoklama">
                          <div className={styles.deviceCell}>
                            <span><Laptop size={14} /> {license.hardwareIdShort || 'Cihaza bağlanmadı'}</span>
                            <span className={heartbeat.live ? styles.heartbeatLive : styles.heartbeatStale}>
                              {heartbeat.live ? <Wifi size={13} /> : <WifiOff size={13} />}{heartbeat.label}
                            </span>
                          </div>
                        </td>
                        <td data-label="Özellikler">
                          <div className={styles.featuresCompact}>
                            {license.features.slice(0, 2).map((feature) => <span key={feature}>{feature}</span>)}
                            {license.features.length > 2 && <span>+{license.features.length - 2}</span>}
                            {!license.features.length && <span>Temel</span>}
                          </div>
                        </td>
                        <td data-label="İşlemler">
                          <div className={styles.rowActions}>
                            <button type="button" onClick={() => openEditor(license)}><PencilLine size={14} /> Yönet</button>
                            <details className={styles.actionMenu}>
                              <summary aria-label={`${license.restaurantName} için diğer işlemler`}><MoreHorizontal size={17} /></summary>
                              <div>
                                {license.status === 'SUSPENDED' && (
                                  <button type="button" disabled={resumingId === license.id} onClick={() => void resumeLicense(license)}>
                                    {resumingId === license.id ? <Loader2 className={styles.spinning} size={14} /> : <Activity size={14} />} Askıyı kaldır
                                  </button>
                                )}
                                {license.status !== 'SUSPENDED' && license.status !== 'REVOKED' && (
                                  <button type="button" onClick={() => openCritical('suspend', license)}><Ban size={14} /> Askıya al</button>
                                )}
                                {license.hardwareIdShort && license.status !== 'REVOKED' && (
                                  <>
                                    <button type="button" onClick={() => openCritical('reset', license)}><RotateCcw size={14} /> Cihazı serbest bırak</button>
                                    <button type="button" onClick={() => openCritical('rebind', license)}><Laptop size={14} /> Yeni cihaza bağla</button>
                                  </>
                                )}
                                {license.status !== 'REVOKED' && (
                                  <button className={styles.dangerAction} type="button" onClick={() => openCritical('revoke', license)}><ShieldAlert size={14} /> Kalıcı iptal</button>
                                )}
                              </div>
                            </details>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {!loading && !filtered.length && !loadError && (
            <div className={styles.emptyState}>
              <span><KeyRound size={23} /></span>
              <strong>Eşleşen lisans yok</strong>
              <p>Arama metnini veya durum filtresini değiştirin.</p>
            </div>
          )}
        </div>
        <footer className={styles.directoryFooter}>
          <span>{filtered.length} kayıt gösteriliyor</span>
          {total > licenses.length && <span>İlk {licenses.length} / toplam {total}</span>}
        </footer>
      </section>

      <Dialog
        open={createOpen}
        onClose={createdKey ? () => createdKeyHeadingRef.current?.focus() : closeCreate}
        titleId="create-license-title"
        descriptionId="create-license-description"
        initialFocusRef={createTenantRef}
        className={styles.createDialog}
      >
        {!createdKey && <button className={styles.closeButton} type="button" onClick={closeCreate} aria-label="Lisans oluşturma penceresini kapat"><X size={18} /></button>}
        {createdKey ? (
          <section className={styles.keyReveal}>
            <span className={styles.successSeal}><Check size={28} /></span>
            <span className={styles.eyebrow}>LİSANS HAZIR</span>
            <h2 id="create-license-title" ref={createdKeyHeadingRef} tabIndex={-1}>Anahtarı şimdi teslim edin.</h2>
            <p id="create-license-description"><strong>{createdLicenseName}</strong> için üretildi. Tam anahtar varsayılan olarak maskelidir ve gösterildikten 15 saniye sonra yeniden gizlenir.</p>
            <div className={styles.keyBox}>
              <code aria-label={showCreatedKey ? 'Tam lisans anahtarı' : 'Maskelenmiş lisans anahtarı'}>{showCreatedKey ? createdKey : maskedCreatedKey}</code>
              <div className={styles.keyActions}>
                <button type="button" onClick={() => setShowCreatedKey((visible) => !visible)} aria-pressed={showCreatedKey}>
                  {showCreatedKey ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  {showCreatedKey ? 'Gizle' : 'Göster'}
                </button>
                <button type="button" onClick={() => void copyKey()}><Copy size={16} aria-hidden="true" /> Kopyala</button>
              </div>
            </div>
            <div className={styles.securityNote}><ShieldCheck size={18} /><span>Anahtarı güvenli bir kanalla müşteriye iletin. Bu pencere kapanınca yalnız maskeli hali kalır.</span></div>
            <button className={styles.primaryButton} type="button" onClick={closeCreate}>Tamam, anahtarı aldım</button>
          </section>
        ) : (
          <form onSubmit={createLicense}>
            <div className={styles.dialogHeading}>
              <span className={styles.eyebrow}>YENİ KURULUM ANAHTARI</span>
              <h2 id="create-license-title">Lisans üret</h2>
              <p id="create-license-description">Restoranı, çalışma süresini ve açılacak modülleri üç kontrollü adımda belirleyin.</p>
            </div>
            <ol className={styles.steps} aria-label="Lisans oluşturma adımları">
              {['Restoran', 'Süre & kapsam', 'Kontrol'].map((label, index) => (
                <li key={label} className={createStep === index + 1 ? styles.currentStep : createStep > index + 1 ? styles.completedStep : ''} aria-current={createStep === index + 1 ? 'step' : undefined}>
                  <span>{createStep > index + 1 ? <Check size={13} /> : index + 1}</span>{label}
                </li>
              ))}
            </ol>

            <div className={styles.stepBody}>
              {createStep === 1 && (
                <div className={styles.formSection}>
                  <label className={styles.field}>
                    <span>Restoran</span>
                    <select
                      ref={createTenantRef}
                      value={createForm.tenantId}
                      onChange={(event) => setCreateForm((current) => ({ ...current, tenantId: event.target.value }))}
                      required
                    >
                      <option value="">Bir restoran seçin</option>
                      {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}{tenant.slug ? ` · ${tenant.slug}` : ''}</option>)}
                    </select>
                    <small>Restoran bilgisi sunucudaki mevcut müşteri kaydından alınır.</small>
                  </label>
                  <div className={styles.infoPanel}>
                    <ShieldCheck size={20} />
                    <div><strong>Tek makineye bağlı lisans</strong><p>Anahtar ilk aktivasyonda cihazın donanım parmak izine atomik olarak bağlanır.</p></div>
                  </div>
                </div>
              )}

              {createStep === 2 && (
                <div className={styles.formSection}>
                  <fieldset className={styles.durationFieldset}>
                    <legend>Lisans süresi</legend>
                    <div>
                      {[30, 90, 365, 730].map((days) => (
                        <label key={days} className={createForm.durationDays === days ? styles.choiceSelected : ''}>
                          <input type="radio" name="duration" value={days} checked={createForm.durationDays === days} onChange={() => setCreateForm((current) => ({ ...current, durationDays: days }))} />
                          <span><strong>{days === 365 ? '1 yıl' : days === 730 ? '2 yıl' : `${days} gün`}</strong><small>{days} takvim günü</small></span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className={styles.twoColumns}>
                    <label className={styles.field}>
                      <span>Özel süre (gün)</span>
                      <input type="number" min="1" max="3650" value={createForm.durationDays} onChange={(event) => setCreateForm((current) => ({ ...current, durationDays: Number(event.target.value) }))} />
                    </label>
                    <label className={styles.field}>
                      <span>İnternetsiz çalışma penceresi</span>
                      <select value={createForm.graceDays} onChange={(event) => setCreateForm((current) => ({ ...current, graceDays: Number(event.target.value) }))}>
                        {[0, 1, 3, 7, 14, 30].map((days) => <option key={days} value={days}>{days === 0 ? 'Yok' : `${days} gün`}</option>)}
                      </select>
                    </label>
                  </div>
                  <fieldset className={styles.featureFieldset}>
                    <legend>Açık modüller</legend>
                    <div className={styles.featureGrid}>
                      {FEATURES.map((feature) => (
                        <label key={feature.key} className={createForm.features.includes(feature.key) ? styles.featureSelected : ''}>
                          <input type="checkbox" checked={createForm.features.includes(feature.key)} onChange={() => toggleFeature(feature.key, 'create')} />
                          <span className={styles.checkboxVisual}><Check size={12} /></span>
                          <span><strong>{feature.label}</strong><small>{feature.description}</small></span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
              )}

              {createStep === 3 && (
                <div className={styles.reviewStep}>
                  <div className={styles.reviewHero}><Sparkles size={22} /><div><strong>İmzaya hazır</strong><p>Üretimden sonra yalnızca bu oturumda tam anahtar gösterilir.</p></div></div>
                  <dl className={styles.reviewList}>
                    <div><dt>Restoran</dt><dd>{selectedTenant?.name ?? '—'}</dd></div>
                    <div><dt>Süre</dt><dd>{createForm.durationDays} gün</dd></div>
                    <div><dt>İnternetsiz pencere</dt><dd>{createForm.graceDays} gün</dd></div>
                    <div><dt>Modüller</dt><dd>{createForm.features.length ? createForm.features.join(', ') : 'Temel lisans'}</dd></div>
                  </dl>
                  <label className={styles.field}>
                    <span>İç not <small>(müşteriye gösterilmez)</small></span>
                    <textarea rows={3} maxLength={1000} value={createForm.notes} onChange={(event) => setCreateForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Sözleşme, satış veya destek notu…" />
                  </label>
                </div>
              )}
            </div>

            {createError && <div className={styles.formError} role="alert"><TriangleAlert size={16} /> {createError}</div>}
            <footer className={styles.dialogFooter}>
              <button className={styles.secondaryButton} type="button" onClick={createStep === 1 ? closeCreate : () => { setCreateError(''); setCreateStep((step) => step - 1); }} disabled={creating}>
                {createStep === 1 ? 'Vazgeç' : <><ArrowLeft size={15} /> Geri</>}
              </button>
              {createStep < 3
                ? <button className={styles.primaryButton} type="button" onClick={nextCreateStep}>Devam <ArrowRight size={15} /></button>
                : <button className={styles.primaryButton} type="submit" disabled={creating}>{creating ? <><Loader2 className={styles.spinning} size={16} /> İmzalanıyor…</> : <><KeyRound size={16} /> Lisansı üret</>}</button>}
            </footer>
          </form>
        )}
      </Dialog>

      <Dialog open={Boolean(editing)} onClose={closeEdit} titleId="edit-license-title" descriptionId="edit-license-description">
        <button className={styles.closeButton} type="button" onClick={closeEdit} aria-label="Lisans yönetim penceresini kapat"><X size={18} /></button>
        {editing && (
          <form onSubmit={saveLicense}>
            <div className={styles.dialogHeading}>
              <span className={styles.eyebrow}>LİSANS AYARLARI</span>
              <h2 id="edit-license-title">{editing.restaurantName}</h2>
              <p id="edit-license-description"><code>{editing.keyMasked}</code> · {formatDate(editing.expiresAt)} tarihine kadar geçerli</p>
            </div>
            <div className={styles.editSummary}>
              <div><Laptop size={17} /><span><small>Cihaz</small><strong>{editing.hardwareIdShort || 'Bağlanmadı'}</strong></span></div>
              <div><Wifi size={17} /><span><small>Son yoklama</small><strong>{formatDate(editing.lastHeartbeatAt, true)}</strong></span></div>
              <div><ShieldAlert size={17} /><span><small>Şüpheli olay</small><strong>{editing.suspiciousCount}</strong></span></div>
            </div>
            <div className={styles.twoColumns}>
              <label className={styles.field}>
                <span>Süreyi uzat</span>
                <select value={editForm.extendDays} onChange={(event) => setEditForm((current) => ({ ...current, extendDays: Number(event.target.value) }))}>
                  <option value={0}>Uzatma yok</option>
                  <option value={30}>30 gün</option>
                  <option value={90}>90 gün</option>
                  <option value={365}>1 yıl</option>
                  <option value={730}>2 yıl</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>İnternetsiz çalışma penceresi</span>
                <select value={editForm.graceDays} onChange={(event) => setEditForm((current) => ({ ...current, graceDays: Number(event.target.value) }))}>
                  {[0, 1, 3, 7, 14, 30].map((days) => <option key={days} value={days}>{days === 0 ? 'Yok' : `${days} gün`}</option>)}
                </select>
              </label>
            </div>
            <fieldset className={styles.featureFieldset}>
              <legend>Açık modüller</legend>
              <div className={styles.featureGrid}>
                {FEATURES.map((feature) => (
                  <label key={feature.key} className={editForm.features.includes(feature.key) ? styles.featureSelected : ''}>
                    <input type="checkbox" checked={editForm.features.includes(feature.key)} onChange={() => toggleFeature(feature.key, 'edit')} />
                    <span className={styles.checkboxVisual}><Check size={12} /></span>
                    <span><strong>{feature.label}</strong><small>{feature.description}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className={styles.field}>
              <span>İç not</span>
              <textarea rows={3} maxLength={1000} value={editForm.notes} onChange={(event) => setEditForm((current) => ({ ...current, notes: event.target.value }))} />
            </label>
            {editError && <div className={styles.formError} role="alert"><TriangleAlert size={16} /> {editError}</div>}
            <footer className={styles.dialogFooter}>
              <button className={styles.secondaryButton} type="button" onClick={closeEdit} disabled={savingEdit}>Vazgeç</button>
              <button className={styles.primaryButton} type="submit" disabled={savingEdit}>{savingEdit ? <><Loader2 className={styles.spinning} size={16} /> Kaydediliyor…</> : <><CheckCircle2 size={16} /> Değişiklikleri kaydet</>}</button>
            </footer>
          </form>
        )}
      </Dialog>

      <Dialog open={Boolean(critical)} onClose={closeCritical} titleId="critical-action-title" descriptionId="critical-action-description" initialFocusRef={confirmationRef} className={styles.criticalDialog}>
        <button className={styles.closeButton} type="button" onClick={closeCritical} aria-label="Kritik işlem penceresini kapat"><X size={18} /></button>
        {critical && (
          <form onSubmit={runCriticalAction}>
            <span className={styles.dangerSeal}><ShieldAlert size={25} /></span>
            <span className={styles.eyebrow}>YÜKSEK YETKİLİ İŞLEM</span>
            <h2 id="critical-action-title">
              {critical.type === 'suspend' ? 'Lisansı askıya al'
                : critical.type === 'revoke' ? 'Lisansı kalıcı iptal et'
                  : critical.type === 'reset' ? 'Cihaz bağını sıfırla'
                    : 'Yeni cihaza yeniden bağla'}
            </h2>
            <p id="critical-action-description">
              <strong>{critical.license.restaurantName}</strong> · <code>{critical.license.keyMasked}</code>
            </p>
            <div className={styles.dangerNotice}>
              <TriangleAlert size={19} />
              <span>{critical.type === 'revoke'
                ? 'Bu işlem geri alınamaz. Lisans sonraki yoklamada kalıcı olarak kilitlenir.'
                : critical.type === 'suspend'
                  ? 'Kurulum sonraki yoklamada kilitlenir; restoran operasyonu durabilir.'
                  : critical.type === 'reset'
                    ? 'Mevcut cihaz serbest bırakılır. Anahtar başka bir bilgisayarda yeniden aktive edilebilir.'
                    : 'Lisans doğrudan verilen donanım kimliğine taşınır. Eski cihaz erişimini kaybeder.'}</span>
            </div>
            {critical.type === 'rebind' && (
              <div className={styles.rebindFields}>
                <label className={styles.field}>
                  <span>Yeni donanım kimliği (SHA-256)</span>
                  <input value={hardwareId} onChange={(event) => setHardwareId(event.target.value)} minLength={64} maxLength={64} autoCapitalize="none" spellCheck={false} required />
                </label>
                <label className={styles.field}>
                  <span>Kısa destek kodu <small>(isteğe bağlı)</small></span>
                  <input value={hardwareIdShort} onChange={(event) => setHardwareIdShort(event.target.value)} maxLength={32} />
                </label>
              </div>
            )}
            <label className={styles.confirmField}>
              <span>Devam etmek için <strong>{requiredPhrase}</strong> yazın</span>
              <input ref={confirmationRef} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} />
            </label>
            {actionError && <div className={styles.formError} role="alert"><TriangleAlert size={16} /> {actionError}</div>}
            <footer className={styles.dialogFooter}>
              <button className={styles.secondaryButton} type="button" onClick={closeCritical} disabled={acting}>Vazgeç</button>
              <button className={styles.dangerButton} type="submit" disabled={confirmation !== requiredPhrase || acting}>
                {acting ? <><Loader2 className={styles.spinning} size={16} /> İşleniyor…</> : requiredPhrase}
              </button>
            </footer>
          </form>
        )}
      </Dialog>
    </main>
  );
}

function StatCard({ label, value, icon, tone, hint }: { label: string; value: number; icon: React.ReactNode; tone: string; hint: string }) {
  return (
    <article className={`${styles.statCard} ${styles[`stat${tone[0].toUpperCase()}${tone.slice(1)}`]}`}>
      <div><span>{label}</span><i>{icon}</i></div>
      <strong>{String(value).padStart(2, '0')}</strong>
      <small>{hint}</small>
    </article>
  );
}

function SkeletonRow() {
  return (
    <tr className={styles.skeletonRow} aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => <td key={index}><span /></td>)}
    </tr>
  );
}
