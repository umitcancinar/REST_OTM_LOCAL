'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import styles from './page.module.css';
import { api } from '@/lib/api';
import {
  X, Save, Trash2, Edit2, Layout, Type, Image as ImageIcon,
  AlignLeft, AlignCenter, AlignRight, CreditCard, ExternalLink,
  Building2, UsersRound, Printer, Palette, ReceiptText, Wifi,
  WifiOff, Play, RotateCcw, ChevronRight, Ruler, Copy, Eye, EyeOff, KeyRound, Clock,
  Radar,
} from 'lucide-react';
import {
  DEFAULT_PRINT_SETTINGS,
  ELEMENT_KEYS,
  ELEMENT_LABELS,
  MAX_BOTTOM_MARGIN_MM,
  MAX_SIDE_MARGIN_MM,
  MAX_TOP_MARGIN_MM,
  mergePrintSettings,
  type Align,
  type ElementKey,
  type ElementStyle,
  type PrintLayoutKey,
  type PrintSettings,
  type ReceiptLabels,
  type Scale,
} from '@/lib/printing';
import ReceiptPreview from './ReceiptPreview';

const LABEL_TITLES: Record<keyof ReceiptLabels, string> = {
  cancelTitle: 'İptal fişi yazısı',
  treatTitle: 'İkram fişi yazısı',
  takeaway: 'Paket yazısı',
  tableInline: 'Masa etiketi (yan yana)',
  tableBlock: 'Masa etiketi (alt alta)',
  dateBlock: 'Tarih etiketi',
  timeBlock: 'Saat etiketi',
  orderNo: 'Fiş no etiketi',
  waiter: 'Garson etiketi',
  colProduct: 'Sütun: Ürün',
  colQty: 'Sütun: Adet',
  colAmount: 'Sütun: Tutar',
  total: 'Toplam etiketi',
  remaining: 'Kalan etiketi',
  payments: 'Tahsilatlar etiketi',
  paidItems: 'Ödenen ürünler etiketi',
  note: 'Ürün notu ön eki',
  treatTag: 'İkram etiketi',
  customer: 'Müşteri etiketi',
  phone: 'Telefon etiketi',
  address: 'Adres etiketi',
  orderNote: 'Sipariş notu etiketi',
  currency: 'Para birimi',
};

const SCALE_OPTIONS: Array<{ value: Scale; label: string }> = [
  { value: 1, label: '1x Normal' },
  { value: 2, label: '2x Büyük' },
  { value: 3, label: '3x Dev' },
  { value: 4, label: '4x Devasa' },
];

const ALIGN_OPTIONS: Array<{ value: Align; label: string }> = [
  { value: 'left', label: 'Sol' },
  { value: 'center', label: 'Orta' },
  { value: 'right', label: 'Sağ' },
];

type SettingsTab = 'general' | 'users' | 'printers' | 'print-design' | 'pos' | 'e-invoice';
type DiscoveredPrinter = { ipAddress: string; port: number; latencyMs: number };

const SETTINGS_TABS = [
  { id: 'general', label: 'Genel Bilgiler', hint: 'İşletme profili', icon: Building2 },
  { id: 'users', label: 'Kullanıcılar', hint: 'Ekip ve roller', icon: UsersRound },
  { id: 'printers', label: 'Yazıcılar', hint: 'Cihaz ve bağlantı', icon: Printer },
  { id: 'print-design', label: 'Çıktı Tasarımı', hint: 'Fiş şablonları', icon: Palette },
  { id: 'pos', label: 'POS & Ödeme', hint: 'Terminal ayarları', icon: CreditCard },
  { id: 'e-invoice', label: 'e-Dönüşüm', hint: 'Fatura entegrasyonu', icon: ReceiptText },
] as const;

function parseSettings(value: unknown): Record<string, any> {
  if (typeof value !== 'string') return value && typeof value === 'object' ? value as Record<string, any> : {};
  try { return JSON.parse(value); } catch { return {}; }
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('printers');
  
  // General Profile State
  const [tenant, setTenant] = useState<any>(null);
  const [showAgentSecret, setShowAgentSecret] = useState(false);
  const [isRegeneratingSecret, setIsRegeneratingSecret] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [subscriptionNow, setSubscriptionNow] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Printers State
  const [printers, setPrinters] = useState<any[]>([]);
  const [newPrinter, setNewPrinter] = useState({ name: '', type: 'RECEIPT', ipAddress: '', port: '9100', customType: '' });
  const [editingPrinter, setEditingPrinter] = useState<any>(null);
  const [isPrintersLoading, setIsPrintersLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<{ agentConnected: boolean; agentCount: number } | null>(null);
  const [testingPrinterId, setTestingPrinterId] = useState<string | null>(null);
  const [isDiscoveringPrinters, setIsDiscoveringPrinters] = useState(false);
  const [discoveredPrinters, setDiscoveredPrinters] = useState<DiscoveredPrinter[]>([]);
  const [printerDiscoveryMessage, setPrinterDiscoveryMessage] = useState('');

  // Print Layout State
  const [printSettings, setPrintSettings] = useState<PrintSettings>(() => mergePrintSettings(DEFAULT_PRINT_SETTINGS));
  const [activeLayoutTab, setActiveLayoutTab] = useState<PrintLayoutKey>('CASHIER');
  
  // Invoice Settings State
  const [invoiceSettings, setInvoiceSettings] = useState({ 
    provider: 'uyumsoft', 
    username: '', 
    password: '', 
    prefix: 'UYM' 
  });

  useEffect(() => {
    async function fetchSettings() {
      try {
        const userProfile = await api.get('/auth/profile');
        if (userProfile?.tenantId) {
           const tenantData = await api.get(`/tenants/${userProfile.tenantId}`);
           setTenant(tenantData);
           
           const settings = parseSettings(tenantData.settings);
           const mergedSettings = mergePrintSettings(settings.printLayouts);
           if (!settings.printLayouts) {
             mergedSettings.CASHIER.headerText = tenantData.name || 'İŞLETME ADI';
             mergedSettings.PAKET.headerText = tenantData.name || 'İŞLETME ADI';
           }
           setPrintSettings(mergedSettings);

            if (settings.invoice) {
              setInvoiceSettings(prev => ({ ...prev, ...settings.invoice }));
           }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchSettings();
  }, []);

  useEffect(() => {
    const refreshClock = () => setSubscriptionNow(Date.now());
    const initialTimer = window.setTimeout(refreshClock, 0);
    const interval = window.setInterval(refreshClock, 60 * 60 * 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, []);

  const loadPrinters = async () => {
    setIsPrintersLoading(true);
    try {
      const [data, status] = await Promise.all([
        api.get('/printers'),
        api.get('/printers/status').catch(() => null),
      ]);
      setPrinters(data);
      setAgentStatus(status);
    } catch(err) {
      console.error(err);
    } finally {
      setIsPrintersLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'printers') {
      loadPrinters();
    }
  }, [activeTab]);

  // Auto-assign departments based on printer type
  const getDepartmentsForType = (type: string): string[] => {
    switch(type) {
      case 'KITCHEN': return ['KITCHEN', 'COLD', 'PASTRY'];
      case 'MANGAL': return ['GRILL'];
      case 'RECEIPT': return ['CASHIER'];
      case 'PAKET': return ['PAKET'];
      case 'BAR': return ['BAR'];
      case 'POS': return ['POS'];
      default: return ['CASHIER']; // Fallback to CASHIER for unknown types
    }
  };

  const handleRegeneratePrintSecret = async () => {
    if (!tenant?.id) return;
    if (!confirm('Anahtarı yenilersen, o bilgisayardaki print-agent yeni anahtarla güncellenene kadar fiş basamaz. Devam edilsin mi?')) return;
    setIsRegeneratingSecret(true);
    try {
      const res = await api.post(`/tenants/${tenant.id}/regenerate-print-secret`, {});
      setTenant({ ...tenant, printAgentSecret: res.printAgentSecret });
      setShowAgentSecret(true);
      alert('✅ Yazıcı anahtarı yenilendi. Yeni anahtarı print-agent bilgisayarındaki .env dosyasına yazman gerekiyor.');
    } catch (err) {
      alert('Anahtar yenilenemedi.');
    } finally {
      setIsRegeneratingSecret(false);
    }
  };

  const handleCreatePrinter = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalType = newPrinter.type === 'CUSTOM' ? newPrinter.customType : newPrinter.type;
    try {
      await api.post('/printers', {
        name: newPrinter.name,
        type: finalType,
        ipAddress: newPrinter.ipAddress,
        port: parseInt(newPrinter.port, 10),
        isActive: true,
        departments: getDepartmentsForType(finalType)
      });
      setNewPrinter({ name: '', type: 'RECEIPT', ipAddress: '', port: '9100', customType: '' });
      await loadPrinters();
    } catch(err) {
      alert('Yazıcı eklenirken hata oluştu.');
    }
  };

  const handleDiscoverPrinters = async () => {
    setIsDiscoveringPrinters(true);
    setPrinterDiscoveryMessage('Aynı ağdaki 9100 portlu termal yazıcılar aranıyor…');
    try {
      const result = await api.get('/printers/discover') as {
        printers: DiscoveredPrinter[];
        scannedAddressCount: number;
        durationMs: number;
      };
      setDiscoveredPrinters(result.printers);
      setPrinterDiscoveryMessage(
        result.printers.length > 0
          ? `${result.printers.length} yazıcı adayı bulundu. Kullanacağın cihazı seç.`
          : `${result.scannedAddressCount} yerel adres kontrol edildi; 9100 portu açık yazıcı bulunamadı. Yazıcının açık, Ethernet/Wi-Fi bağlantısının aynı ağda ve RAW portunun etkin olduğunu kontrol et.`,
      );
    } catch (error: any) {
      setDiscoveredPrinters([]);
      setPrinterDiscoveryMessage(error?.message || 'Yazıcı taraması tamamlanamadı.');
    } finally {
      setIsDiscoveringPrinters(false);
    }
  };

  const selectDiscoveredPrinter = (printer: DiscoveredPrinter) => {
    setNewPrinter((current) => ({
      ...current,
      name: current.name || `Yazıcı ${printer.ipAddress}`,
      ipAddress: printer.ipAddress,
      port: String(printer.port),
    }));
  };

  const handleUpdatePrinter = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.patch(`/printers/${editingPrinter.id}`, {
        name: editingPrinter.name,
        type: editingPrinter.type,
        ipAddress: editingPrinter.ipAddress,
        port: parseInt(editingPrinter.port, 10),
        departments: getDepartmentsForType(editingPrinter.type),
        isActive: editingPrinter.isActive,
      });
      setEditingPrinter(null);
      await loadPrinters();
    } catch(err) {
      alert('Yazıcı güncellenemedi.');
    }
  };

  const handleDeletePrinter = async (id: string) => {
    if(confirm('Yazıcıyı silmek istediğinize emin misiniz?')) {
      try {
        await api.delete(`/printers/${id}`);
        setEditingPrinter(null);
        await loadPrinters();
      } catch(err) {
        alert('Yazıcı silinirken hata oluştu.');
      }
    }
  };

  const getAssignedLayout = (printer: any): PrintLayoutKey => {
    const settings = parseSettings(tenant?.settings);
    const assigned = settings.printerLayoutAssignments?.[printer.id];
    if (['CASHIER', 'KITCHEN', 'GRILL', 'PAKET'].includes(assigned)) return assigned;
    if (printer.departments?.includes('KITCHEN')) return 'KITCHEN';
    if (printer.departments?.includes('GRILL')) return 'GRILL';
    if (printer.departments?.includes('PAKET')) return 'PAKET';
    return 'CASHIER';
  };

  const handlePrinterLayoutAssignment = async (printerId: string, layoutKey: PrintLayoutKey) => {
    if (!tenant?.id) return;
    try {
      const latestTenant = await api.get(`/tenants/${tenant.id}`);
      const currentSettings = parseSettings(latestTenant.settings);
      const response = await api.patch(`/tenants/${tenant.id}`, {
        settings: {
          ...currentSettings,
          printerLayoutAssignments: {
            ...(currentSettings.printerLayoutAssignments || {}),
            [printerId]: layoutKey,
          },
        },
      });
      setTenant(response);
    } catch (err) {
      console.error('Printer template assignment failed', err);
      alert('Yazıcı şablonu atanamadı. Lütfen tekrar deneyin.');
    }
  };

  const handleUpdateLayout = (key: string, value: any) => {
    let finalValue = value;
    if (key === 'logoWidth') {
      const paperWidth = printSettings[activeLayoutTab]?.paperWidth === 58 ? 58 : 80;
      finalValue = Number.isFinite(value) ? Math.min(paperWidth, Math.max(1, value)) : Math.min(50, paperWidth);
    }
    if (key === 'topMarginMm') {
      finalValue = Number.isFinite(value) ? Math.min(MAX_TOP_MARGIN_MM, Math.max(0, value)) : 0;
    }
    if (key === 'bottomMarginMm') {
      finalValue = Number.isFinite(value) ? Math.min(MAX_BOTTOM_MARGIN_MM, Math.max(0, value)) : 0;
    }
    if (key === 'deviceTopTrimMm') {
      finalValue = Number.isFinite(value) ? Math.min(20, Math.max(0, value)) : 0;
    }
    if (key === 'sideMarginMm') {
      finalValue = Number.isFinite(value) ? Math.min(MAX_SIDE_MARGIN_MM, Math.max(0, value)) : 0;
    }

    setPrintSettings(prev => ({
      ...prev,
      [activeLayoutTab]: {
        ...(prev[activeLayoutTab] || DEFAULT_PRINT_SETTINGS[activeLayoutTab] || {}),
        [key]: finalValue
      }
    }));
  };

  const handleUpdateElement = (elementKey: ElementKey, patch: Partial<ElementStyle>) => {
    setPrintSettings(prev => {
      const current = prev[activeLayoutTab];
      return {
        ...prev,
        [activeLayoutTab]: {
          ...current,
          elements: {
            ...current.elements,
            [elementKey]: { ...current.elements[elementKey], ...patch },
          },
        },
      };
    });
  };

  const handleUpdateLabel = (labelKey: keyof ReceiptLabels, value: string) => {
    setPrintSettings(prev => {
      const current = prev[activeLayoutTab];
      return {
        ...prev,
        [activeLayoutTab]: { ...current, labels: { ...current.labels, [labelKey]: value } },
      };
    });
  };

  /** Onizlemedeki surukleme tutamaclarindan gelen bosluk degisikligi. */
  const handleMarginChange = (patch: { topMarginMm?: number; bottomMarginMm?: number }) => {
    setPrintSettings(prev => ({
      ...prev,
      [activeLayoutTab]: { ...prev[activeLayoutTab], ...patch },
    }));
  };

  const handlePaperWidth = (paperWidth: 58 | 80) => {
    setPrintSettings(prev => ({
      ...prev,
      [activeLayoutTab]: {
        ...prev[activeLayoutTab],
        paperWidth,
        logoWidth: Math.min(paperWidth, Number(prev[activeLayoutTab]?.logoWidth) || 50),
      },
    }));
  };

  const resetActiveLayout = () => {
    const reset = mergePrintSettings(DEFAULT_PRINT_SETTINGS);
    setPrintSettings(prev => ({ ...prev, [activeLayoutTab]: reset[activeLayoutTab] }));
  };

  const handleTestPrinter = async (printerId: string) => {
    setTestingPrinterId(printerId);
    try {
      const result = await api.post(`/printers/${printerId}/test`, {});
      alert(`✅ Test fişi yazdırıldı → ${result.printer}`);
      await loadPrinters();
    } catch (error: any) {
      alert(`❌ ${error?.message || 'Test fişi yazdırılamadı'}`);
    } finally {
      setTestingPrinterId(null);
    }
  };

  /**
   * Kalibrasyon fişi: üzerinde kendi beklenen ölçüleri yazılı bir cetvel basar.
   * Çıktı ekrandakiyle uyuşmadığında sebebi tahminle değil, kağıdı cetvelle
   * ölçerek bulmak için kullanılır.
   */
  const handleCalibratePrinter = async (printerId: string) => {
    setTestingPrinterId(printerId);
    try {
      const result = await api.post(`/printers/${printerId}/calibrate`, {});
      alert(
        `📏 Kalibrasyon fişi yazdırıldı → ${result.printer}\n\n` +
        `Fişteki cetveli GERÇEK bir cetvelle ölçün:\n\n` +
        `• Rakamlar tutuyorsa satır aralığı doğru.\n` +
        `• Orantılı kayma varsa (örn. "30 mm" yazan yer 42 mm'de) yazıcı ESC 3 komutunu yok sayıyor.\n` +
        `• En alttaki "SON SATIR" görünmüyorsa kesim payı yetersiz.`
      );
    } catch (error: any) {
      alert(`❌ ${error?.message || 'Kalibrasyon fişi yazdırılamadı'}`);
    } finally {
      setTestingPrinterId(null);
    }
  };

  const handleSavePrintSettings = async () => {
    if (!tenant?.id) {
      alert('İşletme bilgisi yüklenemedi. Lütfen sayfayı yenileyin.');
      return;
    }
    
    setIsSaving(true);
    try {
      // Re-fetch latest tenant data to avoid overwriting other settings
      const latestTenant = await api.get(`/tenants/${tenant.id}`);
      
      const currentSettings = parseSettings(latestTenant.settings);

      const response = await api.patch(`/tenants/${tenant.id}`, {
        settings: {
          ...currentSettings,
          // Tek kaynak: receipt-core normalizasyonu. API ve print-agent ayni
          // fonksiyonu kullandigi icin kaydedilen sey birebir basilan seydir.
          printLayouts: mergePrintSettings(printSettings)
        }
      });
      
      setTenant(response);
      alert('✅ Çıktı tasarımları başarıyla kaydedildi.');
    } catch (err) {
      console.error('Save error:', err);
      alert('❌ Ayarlar kaydedilirken bir hata oluştu. Lütfen bağlantınızı kontrol edin.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveInvoiceSettings = async () => {
    if (!tenant?.id) return;
    setIsSaving(true);
    try {
      const latestTenant = await api.get(`/tenants/${tenant.id}`);
      const currentSettings = parseSettings(latestTenant.settings);

      const response = await api.patch(`/tenants/${tenant.id}`, {
        settings: {
          ...currentSettings,
          invoice: invoiceSettings
        }
      });
      
      setTenant(response);
      alert('✅ Fatura ayarları başarıyla kaydedildi.');
    } catch (err) {
      alert('❌ Ayarlar kaydedilemedi.');
    } finally {
      setIsSaving(false);
    }
  };

  const getPrinterBadgeColor = (type: string) => {
    if (type === 'KITCHEN') return 'badge-warning';
    if (type === 'MANGAL' || type === 'IZGARA') return 'badge-danger';
    if (type === 'RECEIPT' || type === 'KASA') return 'badge-info';
    return 'badge-ghost';
  };

  const getPrinterLabel = (type: string) => {
    if (type === 'KITCHEN') return 'FIRIN';
    if (type === 'MANGAL' || type === 'IZGARA') return 'IZGARA / MANGAL';
    if (type === 'RECEIPT' || type === 'KASA') return 'KASA / ADİSYON';
    if (type === 'PAKET') return 'PAKET SERVİS';
    return type.toUpperCase();
  };

  // Uyelik bitis tarihi hic ayarlanmamissa (subscriptionExpiresAt = null)
  // rozet hic gosterilmez — superadmin bir sure girene kadar mevcut
  // musterilerde herhangi bir gorsel degisiklik olmaz.
  const subscriptionBadge = (() => {
    if (!tenant?.subscriptionExpiresAt || subscriptionNow === null) return null;
    const days = Math.ceil((new Date(tenant.subscriptionExpiresAt).getTime() - subscriptionNow) / (1000 * 60 * 60 * 24));
    if (days < 0) return { text: 'Üyelik süreniz doldu. Lütfen yönetimle iletişime geçin.', bg: 'var(--danger-bg)', color: 'var(--danger)' };
    if (days <= 14) return { text: `Üyelik süreniz: ${days} gün kaldı`, bg: 'var(--warning-bg)', color: 'var(--warning)' };
    return { text: `Üyelik süreniz: ${days} gün kaldı`, bg: 'var(--success-bg)', color: 'var(--success)' };
  })();

  return (
    <div className={`${styles.page} animate-fade-in`} aria-busy={isLoading}>
      {subscriptionBadge && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px', borderRadius: 'var(--radius-md)',
          background: subscriptionBadge.bg, color: subscriptionBadge.color,
          fontSize: '0.8125rem', fontWeight: 700, marginBottom: 16,
        }}>
          <Clock size={15} /> {subscriptionBadge.text}
        </div>
      )}
      <div className={styles.header}>
        <div>
          <span className={styles.eyebrow}>OPERASYON MERKEZİ</span>
          <h1 className={styles.title}>Ayarlar</h1>
          <p className={styles.subtitle}>İşletmenizi, cihazlarınızı ve çıktı standartlarınızı tek merkezden yönetin.</p>
        </div>
        <div className={`${styles.agentPill} ${agentStatus?.agentConnected ? styles.agentOnline : styles.agentOffline}`}>
          {agentStatus?.agentConnected ? <Wifi size={17} /> : <WifiOff size={17} />}
          <div>
            <strong>{agentStatus?.agentConnected ? 'Yazdırma agentı bağlı' : 'Yazdırma agentı çevrimdışı'}</strong>
            <span>{agentStatus?.agentConnected ? `${agentStatus.agentCount} aktif bağlantı` : 'Fiziksel baskı için agentı çalıştırın'}</span>
          </div>
        </div>
      </div>

      <div className={styles.layout}>
        {/* Settings Sidebar */}
        <div className={styles.sidebar}>
          {SETTINGS_TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={`${styles.tabBtn} ${activeTab === tab.id ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className={styles.tabIcon}><Icon size={19} /></span>
                <span className={styles.tabCopy}><strong>{tab.label}</strong><small>{tab.hint}</small></span>
                <ChevronRight size={16} className={styles.tabChevron} />
              </button>
            );
          })}
        </div>

        {/* Content Area - SCROLLABLE */}
        <div className={styles.content}>
          {activeTab === 'general' && (
            <div className="card">
               <h3 style={{ marginBottom: '24px', fontSize: '1.25rem', fontWeight: 800 }}>İşletme Profili & Domain</h3>
               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                  <div className="input-group"><label>Restoran Adı</label><input type="text" className="input" value={tenant?.name || ''} onChange={e => setTenant({...tenant, name: e.target.value})} /></div>
                  <div className="input-group"><label>Telefon</label><input type="text" className="input" value={tenant?.phone || ''} onChange={e => setTenant({...tenant, phone: e.target.value})} /></div>
                  <div className="input-group" style={{ gridColumn: '1 / -1' }}><label>Adres</label><input type="text" className="input" value={tenant?.address || ''} onChange={e => setTenant({...tenant, address: e.target.value})} /></div>
                  
                  {/* Yeni URL Ayarları */}
                  <div className="input-group" style={{ gridColumn: '1 / -1', marginTop: '8px' }}>
                    <label>Web Sitesi Admin URL</label>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <input 
                        type="text" 
                        className="input" 
                        placeholder="Örn: restoranadi.com (http:// yazmayın)"
                        value={tenant?.settings?.webSiteAdminUrl || ''} 
                        onChange={e => setTenant({...tenant, settings: {...(tenant.settings || {}), webSiteAdminUrl: e.target.value}})}
                      />
                      {tenant?.settings?.webSiteAdminUrl && (
                        <a 
                          href={tenant.settings.webSiteAdminUrl.startsWith('http') ? tenant.settings.webSiteAdminUrl : `https://${tenant.settings.webSiteAdminUrl}`} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="btn btn-outline"
                          title="Siteye Git"
                        >
                          <ExternalLink size={18} /> Aç
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                    <label>Mutfak Paneli URL</label>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <input 
                        type="text" 
                        className="input" 
                        placeholder="Örn: https://rets-otm-waiter.vercel.app" 
                        value={tenant?.settings?.kitchenPanelUrl || ''} 
                        onChange={e => setTenant({...tenant, settings: {...(tenant.settings || {}), kitchenPanelUrl: e.target.value}})}
                      />
                      {tenant?.settings?.kitchenPanelUrl && (
                        <a 
                          href={tenant.settings.kitchenPanelUrl.startsWith('http') ? tenant.settings.kitchenPanelUrl : `https://${tenant.settings.kitchenPanelUrl}`} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="btn btn-outline"
                          title="Siteye Git"
                        >
                          <ExternalLink size={18} /> Aç
                        </a>
                      )}
                    </div>
                  </div>
                  
                  <div className="input-group" style={{ gridColumn: '1 / -1', marginTop: '16px' }}>
                    <label>Özel Domain (Web Sitesi İçin)</label>
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                      Restoranınızın müşteri web sitesine hangi domain üzerinden ulaşılacağını belirleyin. (Örn: www.tarihiadana.com veya adana.restotm.com)
                    </p>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <input 
                        type="text" 
                        className="input" 
                        placeholder="Örn: www.tarihiadana.com" 
                        value={tenant?.customDomain || ''} 
                        onChange={e => setTenant({...tenant, customDomain: e.target.value})}
                      />
                      <button 
                        className="btn btn-primary" 
                        onClick={async () => {
                          if (!tenant?.id) return;
                          try {
                            const res = await api.patch(`/tenants/${tenant.id}`, { 
                              name: tenant.name,
                              phone: tenant.phone,
                              address: tenant.address,
                              customDomain: tenant.customDomain,
                              settings: tenant.settings
                            });
                            setTenant(res);
                            localStorage.setItem('tenantSettings', JSON.stringify(res.settings));
                            alert('✅ İşletme bilgileri başarıyla güncellendi.');
                          } catch (err) {
                            alert('❌ Bilgiler güncellenemedi. Domain başka bir restoran tarafından kullanılıyor olabilir.');
                          }
                        }}
                      >
                        Kaydet
                      </button>
                    </div>
                  </div>
               </div>
            </div>
          )}

          {activeTab === 'users' && (
            <div className={styles.navigationCard}>
              <div className={styles.navigationIcon}><UsersRound size={26} /></div>
              <div>
                <span className={styles.sectionKicker}>EKİP YÖNETİMİ</span>
                <h3>Kullanıcılar ve roller</h3>
                <p>Kullanıcı ekleme, rol atama, PIN ve hesap durumları ekip yönetimi ekranında güvenli biçimde yönetilir.</p>
              </div>
              <Link href="/staff" className="btn btn-primary">
                Ekip yönetimine git <ChevronRight size={17} />
              </Link>
            </div>
          )}

          {activeTab === 'printers' && (
            <div className="stagger-children">
              <div className="card" style={{ marginBottom: '24px' }}>
                <h3 style={{ marginBottom: '4px', fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <KeyRound size={20} /> Yazıcı Agent Anahtarı
                </h3>
                <p style={{ marginBottom: '16px', fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>
                  Bu anahtar, restorandaki bilgisayarda çalışan yazıcı programının (print-agent) sadece SİZİN siparişlerinizi görebilmesini sağlar. O bilgisayardaki ayar dosyasına (.env) yazılır.
                </p>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <code style={{
                    flex: '1 1 320px', padding: '10px 14px', borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    fontSize: '0.8125rem', letterSpacing: '0.02em', wordBreak: 'break-all',
                  }}>
                    {tenant?.printAgentSecret
                      ? (showAgentSecret ? tenant.printAgentSecret : '•'.repeat(48))
                      : 'Henüz üretilmedi'}
                  </code>
                  <button type="button" className="btn btn-ghost" title={showAgentSecret ? 'Gizle' : 'Göster'} onClick={() => setShowAgentSecret(v => !v)}>
                    {showAgentSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    title="Kopyala"
                    disabled={!tenant?.printAgentSecret}
                    onClick={() => { navigator.clipboard.writeText(tenant.printAgentSecret); alert('Kopyalandı.'); }}
                  >
                    <Copy size={16} />
                  </button>
                  <button type="button" className="btn btn-ghost" disabled={isRegeneratingSecret} onClick={handleRegeneratePrintSecret}>
                    <RotateCcw size={16} /> {isRegeneratingSecret ? 'Yenileniyor…' : 'Yenile'}
                  </button>
                </div>
              </div>

              <div className="card" style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                  <div>
                    <h3 style={{ marginBottom: '4px', fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>🖨️ Yeni Yazıcı Ekle</h3>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>IP bilmiyorsan aynı yerel ağı otomatik tara.</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={isDiscoveringPrinters}
                    onClick={handleDiscoverPrinters}
                  >
                    <Radar size={17} /> {isDiscoveringPrinters ? 'Taranıyor…' : 'Yazıcıları Tara'}
                  </button>
                </div>
                {printerDiscoveryMessage && (
                  <div style={{
                    padding: '12px 14px', marginBottom: 14, borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    color: 'var(--text-secondary)', fontSize: '0.8125rem',
                  }}>
                    {printerDiscoveryMessage}
                  </div>
                )}
                {discoveredPrinters.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
                    {discoveredPrinters.map((printer) => (
                      <button
                        key={`${printer.ipAddress}:${printer.port}`}
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => selectDiscoveredPrinter(printer)}
                        title="Bu adresi yeni yazıcı formuna aktar"
                      >
                        <Wifi size={15} /> {printer.ipAddress}:{printer.port} · {printer.latencyMs} ms
                      </button>
                    ))}
                  </div>
                )}
                <form onSubmit={handleCreatePrinter} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', alignItems: 'flex-end' }}>
                  <div className="input-group" style={{ marginBottom: 0 }}><label>Yazıcı Adı</label><input required type="text" className="input" placeholder="Örn: Ana Mutfak" value={newPrinter.name} onChange={e => setNewPrinter({...newPrinter, name: e.target.value})} /></div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                     <label>Yazıcı Tipi</label>
                     <select className="input" value={newPrinter.type} onChange={e => setNewPrinter({...newPrinter, type: e.target.value})}>
                       <option value="RECEIPT">💰 Kasa / Adisyon</option>
                       <option value="KITCHEN">🍳 Fırın</option>
                       <option value="MANGAL">🔥 Izgara / Mangal</option>
                       <option value="PAKET">📦 Paket Servis</option>
                       <option value="POS">💳 POS Terminali</option>
                       <option value="CUSTOM">➕ Diğer (Kendin Yaz)</option>
                     </select>
                  </div>
                  {newPrinter.type === 'CUSTOM' && (
                    <div className="input-group" style={{ marginBottom: 0 }}><label>Özel Birim Adı</label><input required type="text" className="input" placeholder="Örn: BAR" value={newPrinter.customType} onChange={e => setNewPrinter({...newPrinter, customType: e.target.value.toUpperCase()})} /></div>
                  )}
                  <div className="input-group" style={{ marginBottom: 0, flex: 0.8 }}><label>IP Adresi</label><input required type="text" className="input" placeholder="192.168.1.50" value={newPrinter.ipAddress} onChange={e => setNewPrinter({...newPrinter, ipAddress: e.target.value})} /></div>
                  <div className="input-group" style={{ marginBottom: 0, flex: 0.4 }}><label>Port</label><input required type="text" className="input" placeholder="9100" value={newPrinter.port} onChange={e => setNewPrinter({...newPrinter, port: e.target.value})} /></div>
                  <button type="submit" className="btn btn-primary" style={{ height: '44px' }}>Kaydet</button>
                </form>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px', paddingBottom: '40px' }}>
                {isPrintersLoading ? (
                   <div className="card" style={{ textAlign: 'center', padding: '40px' }}>Yükleniyor...</div>
                ) : printers.length === 0 ? (
                   <div className="card" style={{ textAlign: 'center', padding: '40px', gridColumn: '1 / -1', opacity: 0.6 }}><p>Henüz bir yazıcı eklenmemiş.</p></div>
                ) : (
                  printers.map(p => (
                    <div 
                      key={p.id} 
                      className="card hover-pop" 
                      onClick={() => setEditingPrinter(p)}
                      style={{ cursor: 'pointer', position: 'relative', borderTop: `4px solid var(--accent)` }}
                    >
                       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                          <div>
                             <h4 style={{ fontSize: '1.125rem', fontWeight: 800, marginBottom: 4 }}>{p.name}</h4>
                             <span className={`badge ${getPrinterBadgeColor(p.type)}`} style={{ fontSize: '10px' }}>
                                {getPrinterLabel(p.type)}
                             </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                             <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.isActive && agentStatus?.agentConnected ? 'var(--success)' : 'var(--text-muted)' }}></div>
                             <span style={{ fontSize: '11px', fontWeight: 700, color: p.isActive && agentStatus?.agentConnected ? 'var(--success)' : 'var(--text-muted)' }}>
                               {!p.isActive ? 'PASİF' : agentStatus?.agentConnected ? 'AGENT BAĞLI' : 'AGENT BEKLENİYOR'}
                             </span>
                          </div>
                       </div>
                       
                       <div style={{ background: 'var(--bg-elevated)', padding: '12px', borderRadius: 'var(--radius-md)', marginBottom: 12, fontSize: '0.875rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                             <span style={{ color: 'var(--text-tertiary)' }}>IP:</span>
                             <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{p.ipAddress}:{p.port}</span>
                          </div>
                       </div>

                       <label onClick={e => e.stopPropagation()} style={{ display: 'block', marginBottom: 12, fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                         Çıktı şablonu
                         <select
                           className="input"
                           style={{ marginTop: 6, padding: '7px 9px', fontSize: '0.8125rem' }}
                           value={getAssignedLayout(p)}
                           onChange={e => handlePrinterLayoutAssignment(p.id, e.target.value as PrintLayoutKey)}
                         >
                           <option value="CASHIER">Adisyon şablonu</option>
                           <option value="KITCHEN">Fırın şablonu</option>
                           <option value="GRILL">Izgara şablonu</option>
                           <option value="PAKET">Paket şablonu</option>
                         </select>
                       </label>

                       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                          {!p.departments?.includes('POS') && (
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '8px 12px', fontSize: '0.75rem' }}
                                disabled={testingPrinterId === p.id || !p.isActive}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleTestPrinter(p.id);
                                }}
                              >
                                <Play size={13} />
                                {testingPrinterId === p.id ? 'Test ediliyor...' : 'Test fişi'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ padding: '8px 12px', fontSize: '0.75rem' }}
                                disabled={testingPrinterId === p.id || !p.isActive}
                                title="Üzerinde cetvel olan teşhis fişi basar. Çıktı ekrandakiyle uyuşmuyorsa sebebini bulmak için kullanın."
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleCalibratePrinter(p.id);
                                }}
                              >
                                <Ruler size={13} />
                                Kalibrasyon
                              </button>
                            </div>
                          )}
                          <div style={{ color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Edit2 size={12} /> Düzenlemek için tıkla
                          </div>
                       </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'print-design' && (
            <div className="animate-fade-in">
              <div className="card" style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>🎨 Fiş & Adisyon Tasarımı</h3>
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Termal yazıcı çıktılarını özelleştirin</p>
                  </div>
                  <div className={styles.headerActions}>
                    <button type="button" className="btn btn-secondary" onClick={resetActiveLayout} disabled={isSaving}>
                      <RotateCcw size={17} /> Şablonu sıfırla
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleSavePrintSettings}
                      disabled={isSaving}
                    >
                      <Save size={18} /> {isSaving ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
                    </button>
                  </div>
                </div>

                {/* Sub-tabs for layout types */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', background: 'var(--bg-muted)', padding: '6px', borderRadius: 'var(--radius-lg)' }}>
                  <button 
                    onClick={() => setActiveLayoutTab('CASHIER')}
                    className={`${styles.layoutTab} ${activeLayoutTab === 'CASHIER' ? styles.layoutTabActiveCashier : ''}`}
                  >
                    💰 Adisyon
                  </button>
                  <button 
                    onClick={() => setActiveLayoutTab('KITCHEN')}
                    className={`${styles.layoutTab} ${activeLayoutTab === 'KITCHEN' ? styles.layoutTabActiveKitchen : ''}`}
                  >
                    🍳 Fırın
                  </button>
                  <button 
                    onClick={() => setActiveLayoutTab('GRILL')}
                    className={`${styles.layoutTab} ${activeLayoutTab === 'GRILL' ? styles.layoutTabActiveGrill : ''}`}
                  >
                    🔥 Izgara / Mangal
                  </button>
                  <button 
                    onClick={() => setActiveLayoutTab('PAKET')}
                    className={`${styles.layoutTab} ${activeLayoutTab === 'PAKET' ? styles.layoutTabActivePaket : ''}`}
                  >
                    📦 Paket Fişi
                  </button>
                </div>

                <div className={styles.printLayoutGrid}>
                  {/* Form Side */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    <div className="input-group">
                      <label>Termal Kağıt Genişliği</label>
                      <div className={styles.segmentedControl}>
                        {[58, 80].map(width => (
                          <button
                            key={width}
                            type="button"
                            className={printSettings[activeLayoutTab].paperWidth === width ? styles.segmentActive : ''}
                            onClick={() => handlePaperWidth(width as 58 | 80)}
                          >
                            <strong>{width} mm</strong>
                            <span>{width === 58 ? 'Kompakt fiş' : 'Standart / geniş'}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="input-group">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ImageIcon size={16} /> Logo URL (Görsel Linki)
                      </label>
                      <input 
                        type="text" 
                        className="input" 
                        placeholder="https://example.com/logo.png"
                        value={printSettings[activeLayoutTab]?.logoUrl || ''}
                        onChange={e => handleUpdateLayout('logoUrl', e.target.value)}
                      />
                    </div>

                    <div className={styles.grid2Col}>
                      <div className="input-group">
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Type size={16} /> Fiş Başlığı (Orta Kısım)
                        </label>
                        <input 
                          type="text" 
                          className="input" 
                          placeholder="Örn: ADİSYON"
                          value={printSettings[activeLayoutTab]?.receiptTitle || ''}
                          onChange={e => handleUpdateLayout('receiptTitle', e.target.value)}
                        />
                      </div>
                      <div className="input-group">
                        <label>Logo Pozisyonu</label>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button 
                            type="button"
                            className={`btn ${printSettings[activeLayoutTab]?.logoPosition === 'left' ? 'btn-primary' : 'btn-ghost'}`}
                            style={{ flex: 1, padding: '8px' }}
                            onClick={() => handleUpdateLayout('logoPosition', 'left')}
                          >
                            <AlignLeft size={18} />
                          </button>
                          <button 
                            type="button"
                            className={`btn ${printSettings[activeLayoutTab]?.logoPosition === 'center' ? 'btn-primary' : 'btn-ghost'}`}
                            style={{ flex: 1, padding: '8px' }}
                            onClick={() => handleUpdateLayout('logoPosition', 'center')}
                          >
                            <AlignCenter size={18} />
                          </button>
                          <button 
                            type="button"
                            className={`btn ${printSettings[activeLayoutTab]?.logoPosition === 'right' ? 'btn-primary' : 'btn-ghost'}`}
                            style={{ flex: 1, padding: '8px' }}
                            onClick={() => handleUpdateLayout('logoPosition', 'right')}
                          >
                            <AlignRight size={18} />
                          </button>
                        </div>
                      </div>
                      <div className="input-group">
                        <label>Logo Genişliği (mm, maks. {printSettings[activeLayoutTab].paperWidth || 80})</label>
                        <input 
                          type="number" 
                          className="input" 
                          min="1"
                          max={printSettings[activeLayoutTab].paperWidth || 80}
                          value={printSettings[activeLayoutTab]?.logoWidth || 50}
                          onChange={e => handleUpdateLayout('logoWidth', parseInt(e.target.value))}
                        />
                      </div>
                      <div className="input-group">
                        <label>Kağıt Üst Boşluğu (0–{MAX_TOP_MARGIN_MM} mm)</label>
                        <input
                          type="number"
                          className="input"
                          min="0"
                          max={MAX_TOP_MARGIN_MM}
                          step="0.5"
                          value={printSettings[activeLayoutTab]?.topMarginMm ?? 0}
                          onChange={e => handleUpdateLayout('topMarginMm', Number(e.target.value))}
                        />
                        <small style={{ color: 'var(--text-tertiary)' }}>Fiş başlamadan önce bırakılacak gerçek kağıt boşluğu. Önizlemedeki üst şeritten de sürükleyebilirsin.</small>
                      </div>
                      <div className="input-group">
                        <label>Kağıt Alt Boşluğu / Kesim Payı (0–{MAX_BOTTOM_MARGIN_MM} mm)</label>
                        <input
                          type="number"
                          className="input"
                          min="0"
                          max={MAX_BOTTOM_MARGIN_MM}
                          step="0.5"
                          value={printSettings[activeLayoutTab]?.bottomMarginMm ?? 0}
                          onChange={e => handleUpdateLayout('bottomMarginMm', Number(e.target.value))}
                        />
                        <small style={{ color: 'var(--text-tertiary)' }}>Son satır ile kesim arasındaki boşluk. Çok düşürürsen son satırlar yazıcının içinde kalabilir.</small>
                      </div>
                      <div className="input-group">
                        <label>Cihaz Üst Payı (0–20 mm)</label>
                        <input
                          type="number"
                          className="input"
                          min="0"
                          max="20"
                          step="0.5"
                          value={printSettings[activeLayoutTab]?.deviceTopTrimMm ?? 0}
                          onChange={e => handleUpdateLayout('deviceTopTrimMm', Number(e.target.value))}
                        />
                        <small style={{ color: 'var(--text-tertiary)' }}>Bu yazıcının mekanik başlangıç payı. Üst boşluktan otomatik düşülür; önizleme de aynısını gösterir.</small>
                      </div>
                      <div className="input-group">
                        <label>Sağ / Sol Kenar Boşluğu (0–{MAX_SIDE_MARGIN_MM} mm)</label>
                        <input
                          type="number"
                          className="input"
                          min="0"
                          max={MAX_SIDE_MARGIN_MM}
                          step="0.5"
                          value={printSettings[activeLayoutTab]?.sideMarginMm ?? 0}
                          onChange={e => handleUpdateLayout('sideMarginMm', Number(e.target.value))}
                        />
                        <small style={{ color: 'var(--text-tertiary)' }}>Fişin sağında ve solunda simetrik olarak bırakılacak boşluk. İçerik ortadan daralır, kenarlar boş kalır.</small>
                      </div>
                    </div>

                    <div className={styles.grid2Col}>
                      <div className="input-group">
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Type size={16} /> Başlık Metni
                        </label>
                        <input 
                          type="text" 
                          className="input" 
                          value={printSettings[activeLayoutTab]?.headerText || ''}
                          onChange={e => handleUpdateLayout('headerText', e.target.value)}
                        />
                      </div>
                      <div className="input-group">
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Type size={16} /> İkincil Başlık (Alt Başlık)
                        </label>
                        <input 
                          type="text" 
                          className="input" 
                          placeholder="Örn: TARİHİ ADANA KEBAPÇISI"
                          value={printSettings[activeLayoutTab]?.subHeaderText || ''}
                          onChange={e => handleUpdateLayout('subHeaderText', e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="input-group" style={{ background: 'var(--surface-50)', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '12px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        <Layout size={16} /> Genel Yerleşim
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>
                          <input
                            type="checkbox"
                            checked={printSettings[activeLayoutTab]?.hidePrices || false}
                            onChange={e => handleUpdateLayout('hidePrices', e.target.checked)}
                          />
                          Tutarları / Fiyatları Gizle
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>
                          <input
                            type="checkbox"
                            checked={printSettings[activeLayoutTab]?.inlineDateMasa || false}
                            onChange={e => handleUpdateLayout('inlineDateMasa', e.target.checked)}
                          />
                          Tarih/Saat ve Masayı Yan Yana Yaz
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>
                          <input
                            type="checkbox"
                            checked={printSettings[activeLayoutTab]?.showItemSeparator || false}
                            onChange={e => handleUpdateLayout('showItemSeparator', e.target.checked)}
                          />
                          Ürünler Arasına Ayraç Koy
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>
                          <input
                            type="checkbox"
                            checked={printSettings[activeLayoutTab]?.showPaidItems || false}
                            onChange={e => handleUpdateLayout('showPaidItems', e.target.checked)}
                          />
                          Ödenen Ürünleri Fişin Altına Yaz
                        </label>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px', marginTop: 16 }}>
                        <div className="input-group" style={{ margin: 0 }}>
                          <label style={{ fontSize: '0.8rem' }}>Adet Sütun Genişliği</label>
                          <input type="number" className="input" min="2" max="10"
                            value={printSettings[activeLayoutTab]?.qtyWidth ?? 5}
                            onChange={e => handleUpdateLayout('qtyWidth', Number(e.target.value))} />
                        </div>
                        <div className="input-group" style={{ margin: 0 }}>
                          <label style={{ fontSize: '0.8rem' }}>Tutar Sütun Genişliği</label>
                          <input type="number" className="input" min="0" max="20"
                            value={printSettings[activeLayoutTab]?.priceWidth ?? 12}
                            onChange={e => handleUpdateLayout('priceWidth', Number(e.target.value))} />
                        </div>
                        <div className="input-group" style={{ margin: 0 }}>
                          <label style={{ fontSize: '0.8rem' }}>Ana Ayraç</label>
                          <input type="text" className="input" maxLength={1}
                            value={printSettings[activeLayoutTab]?.separatorChar ?? '-'}
                            onChange={e => handleUpdateLayout('separatorChar', e.target.value)} />
                        </div>
                        <div className="input-group" style={{ margin: 0 }}>
                          <label style={{ fontSize: '0.8rem' }}>Ürün Ayracı</label>
                          <input type="text" className="input" maxLength={1}
                            value={printSettings[activeLayoutTab]?.itemSeparatorChar ?? '.'}
                            onChange={e => handleUpdateLayout('itemSeparatorChar', e.target.value)} />
                        </div>
                      </div>
                    </div>

                    {/* ---- Oge bazli tasarim ---- */}
                    <div className="input-group" style={{ background: 'var(--surface-50)', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '4px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        <Type size={16} /> Öğe Bazlı Tasarım
                      </label>
                      <small style={{ color: 'var(--text-tertiary)', display: 'block', marginBottom: 12 }}>
                        Fişteki her parçanın görünürlüğünü, puntosunu, kalınlığını ve hizasını ayrı ayrı ayarla. Değişiklik anında önizlemeye yansır.
                      </small>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {ELEMENT_KEYS.map((elementKey) => {
                          const element = printSettings[activeLayoutTab]?.elements?.[elementKey];
                          if (!element) return null;
                          return (
                            <div key={elementKey} style={{ display: 'grid', gridTemplateColumns: '1.6fr auto auto 1fr 1fr', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 8, background: 'var(--bg-muted)' }}>
                              <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{ELEMENT_LABELS[elementKey]}</span>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', cursor: 'pointer' }}>
                                <input type="checkbox" checked={element.visible}
                                  onChange={e => handleUpdateElement(elementKey, { visible: e.target.checked })} />
                                Göster
                              </label>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', cursor: 'pointer' }}>
                                <input type="checkbox" checked={element.bold}
                                  onChange={e => handleUpdateElement(elementKey, { bold: e.target.checked })} />
                                Kalın
                              </label>
                              <select className="input" style={{ padding: '4px 6px', fontSize: '0.75rem' }} value={element.scale}
                                onChange={e => handleUpdateElement(elementKey, { scale: Number(e.target.value) as Scale })}>
                                {SCALE_OPTIONS.map(option => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                              <select className="input" style={{ padding: '4px 6px', fontSize: '0.75rem' }} value={element.align}
                                onChange={e => handleUpdateElement(elementKey, { align: e.target.value as Align })}>
                                {ALIGN_OPTIONS.map(option => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* ---- Metin/etiket sozlugu ---- */}
                    <div className="input-group" style={{ background: 'var(--surface-50)', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '4px', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        <Type size={16} /> Fişteki Yazılar
                      </label>
                      <small style={{ color: 'var(--text-tertiary)', display: 'block', marginBottom: 12 }}>
                        İPTAL, PAKET, TOPLAM, KALAN gibi kağıda basılan tüm sabit yazıları buradan değiştirebilirsin.
                      </small>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {(Object.keys(LABEL_TITLES) as Array<keyof ReceiptLabels>).map((labelKey) => (
                          <div className="input-group" key={labelKey} style={{ margin: 0 }}>
                            <label style={{ fontSize: '0.75rem' }}>{LABEL_TITLES[labelKey]}</label>
                            <input
                              type="text"
                              className="input"
                              value={printSettings[activeLayoutTab]?.labels?.[labelKey] ?? ''}
                              onChange={e => handleUpdateLabel(labelKey, e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="input-group">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Layout size={16} /> Alt Bilgi (Footer) Notu
                      </label>
                      <textarea 
                        className="input" 
                        rows={3}
                        style={{ height: 'auto', paddingTop: '12px' }}
                        value={printSettings[activeLayoutTab]?.footerText || ''}
                        onChange={e => handleUpdateLayout('footerText', e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Onizleme — print-agent ile ayni motoru kullanir */}
                  <ReceiptPreview
                    type={activeLayoutTab}
                    layout={printSettings[activeLayoutTab]}
                    onMarginChange={handleMarginChange}
                  />
                </div>
              </div>
            </div>
          )}
          
          {activeTab === 'pos' && (
            <div className="stagger-children">
              <div className="card" style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                  <div style={{ padding: 12, background: 'var(--accent-bg)', borderRadius: 12 }}>
                    <CreditCard size={24} color="var(--accent)" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>💳 POS Entegrasyonu</h3>
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>GMP3 protokolü destekli POS cihazlarınızı buradan yönetebilirsiniz.</p>
                  </div>
                </div>

                <div style={{ padding: '16px', background: 'var(--bg-muted)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', marginBottom: '24px' }}>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    <strong>💡 Bilgi:</strong> POS cihazınızın <strong>“Entegrasyon Modu”</strong>nda olduğundan ve <strong>LRC</strong> kontrolünün aktif olduğundan emin olun.
                    Cihazın yerel IP adresini ve port numarasını (Genellikle 1000 veya 2000) aşağıya giriniz.
                  </p>
                </div>

                <div className="data-table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Cihaz Adı</th>
                        <th>IP Adresi</th>
                        <th>Port</th>
                        <th>Durum</th>
                        <th style={{ textAlign: 'right' }}>İşlem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {printers.filter(p => p.departments.includes('POS')).length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
                            Kayıtlı POS cihazı bulunmuyor. “Yazıcı Ayarları” sekmesinden “POS Terminali” tipinde yeni bir cihaz ekleyebilirsiniz.
                          </td>
                        </tr>
                      ) : (
                        printers.filter(p => p.departments.includes('POS')).map(pos => (
                          <tr key={pos.id}>
                            <td style={{ fontWeight: 700 }}>{pos.name}</td>
                            <td><code>{pos.ipAddress}</code></td>
                            <td>{pos.port}</td>
                            <td>
                              <span className={`badge ${pos.isActive ? 'badge-success' : 'badge-danger'}`}>
                                {pos.isActive ? 'Aktif' : 'Pasif'}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button className="btn btn-ghost" style={{ padding: 8 }} onClick={() => { setEditingPrinter(pos); }}>
                                <Edit2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'e-invoice' && (
            <div className="stagger-children">
              <div className="card" style={{ marginBottom: '24px' }}>
                <h3 style={{ marginBottom: '8px', fontSize: '1.25rem', fontWeight: 800 }}>e-Dönüşüm (Fatura) Ayarları</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.875rem' }}>
                  Uyumsoft veya benzeri entegratörler üzerinden e-Arşiv / e-Fatura kesebilmek için API bilgilerinizi girin.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 600 }}>
                  <div className="input-group">
                    <label>Entegratör Firması</label>
                    <select 
                      className="input" 
                      value={invoiceSettings.provider}
                      onChange={e => setInvoiceSettings({...invoiceSettings, provider: e.target.value})}
                    >
                      <option value="uyumsoft">Uyumsoft</option>
                      <option value="logo">Logo İşbaşı</option>
                      <option value="parasut">Paraşüt</option>
                      <option value="trendyol">Trendyol e-Fatura</option>
                    </select>
                  </div>
                  <div className="input-group">
                    <label>API Kullanıcı Adı</label>
                    <input 
                      type="text" 
                      className="input" 
                      placeholder="API User" 
                      value={invoiceSettings.username}
                      onChange={e => setInvoiceSettings({...invoiceSettings, username: e.target.value})}
                    />
                  </div>
                  <div className="input-group">
                    <label>API Şifresi</label>
                    <input 
                      type="password" 
                      className="input" 
                      placeholder="••••••••" 
                      value={invoiceSettings.password}
                      onChange={e => setInvoiceSettings({...invoiceSettings, password: e.target.value})}
                    />
                  </div>
                  <div className="input-group">
                    <label>Fatura Ön Eki (Seri No)</label>
                    <input 
                      type="text" 
                      className="input" 
                      placeholder="Örn: UYM" 
                      value={invoiceSettings.prefix}
                      onChange={e => setInvoiceSettings({...invoiceSettings, prefix: e.target.value})}
                    />
                  </div>

                  <button 
                    className="btn btn-primary" 
                    style={{ alignSelf: 'flex-start', marginTop: 12 }}
                    onClick={handleSaveInvoiceSettings}
                    disabled={isSaving}
                  >
                    <Save size={18} /> {isSaving ? 'Kaydediliyor...' : 'Ayarları Kaydet'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* EDIT MODAL */}
      {editingPrinter && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(10px)' }}>
           <div className="card animate-scale-in" style={{ width: '100%', maxWidth: 450, padding: 32 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                 <h3 style={{ fontSize: '1.5rem', fontWeight: 900 }}>Yazıcıyı Düzenle</h3>
                 <button onClick={() => setEditingPrinter(null)} className="btn btn-ghost" style={{ padding: 8 }}><X size={24} /></button>
              </div>

              <form onSubmit={handleUpdatePrinter} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                 <div className="input-group"><label>Yazıcı Adı</label><input required type="text" className="input" value={editingPrinter.name} onChange={e => setEditingPrinter({...editingPrinter, name: e.target.value})} /></div>
                 <div className="input-group">
                    <label>Yazıcı Tipi</label>
                    <select className="input" value={editingPrinter.type} onChange={e => setEditingPrinter({...editingPrinter, type: e.target.value})}>
                       <option value="RECEIPT">💰 Kasa / Adisyon</option>
                       <option value="KITCHEN">🍳 Fırın</option>
                       <option value="MANGAL">🔥 Izgara / Mangal</option>
                       <option value="PAKET">📦 Paket Servis</option>
                       <option value="POS">💳 POS Terminali</option>
                    </select>
                 </div>
                 <div style={{ display: 'flex', gap: 12 }}>
                    <div className="input-group" style={{ flex: 2 }}><label>IP Adresi</label><input required type="text" className="input" value={editingPrinter.ipAddress} onChange={e => setEditingPrinter({...editingPrinter, ipAddress: e.target.value})} /></div>
                    <div className="input-group" style={{ flex: 1 }}><label>Port</label><input required type="text" className="input" value={editingPrinter.port} onChange={e => setEditingPrinter({...editingPrinter, port: e.target.value})} /></div>
                 </div>

                 <label className={styles.toggleRow}>
                    <span>
                      <strong>Cihaz aktif</strong>
                      <small>Pasif cihazlara otomatik çıktı yönlendirilmez.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={Boolean(editingPrinter.isActive)}
                      onChange={e => setEditingPrinter({ ...editingPrinter, isActive: e.target.checked })}
                    />
                 </label>
                 
                 <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                    <button type="button" onClick={() => handleDeletePrinter(editingPrinter.id)} className="btn btn-ghost" style={{ color: 'var(--accent-danger)', flex: 1 }}><Trash2 size={18} /> Sil</button>
                    <button type="submit" className="btn btn-primary" style={{ flex: 2 }}><Save size={18} /> Güncelle</button>
                 </div>
              </form>
           </div>
        </div>
      )}
    </div>
  );
}
