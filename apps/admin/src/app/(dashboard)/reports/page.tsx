'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api';
import { useNotifications } from '@/context/NotificationContext';
import { downloadCsv } from '@/lib/csv';
import {
  TrendingUp, ShoppingBag, Receipt, Users, Download,
  Calendar, RefreshCcw, Award, CreditCard, Banknote,
  ChefHat, Flame, Beer, Cake, Snowflake, Loader2, X, Landmark, Printer
} from 'lucide-react';
import styles from './page.module.css';
import { useToast } from '@/components/ui/Toast';
import { PAYMENT_LABELS, paymentBreakdown } from '@/lib/payments';
import { formatBusinessDate } from '@/lib/dates';

// ─── Helpers ─────────────────────────────────────────
const fmt = (n: number) =>
  n.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

type ReportPreset = { label: string; start: string; end: string };

// Gun hesabi isletme saat diliminden (Europe/Istanbul) yapilir: @/lib/dates
const formatIstanbulDate = formatBusinessDate;

const getReportPresets = (now = new Date()): ReportPreset[] => {
  const today = formatIstanbulDate(now);
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(now);
  monthAgo.setDate(monthAgo.getDate() - 30);

  return [
    { label: 'Bugün', start: today, end: today },
    { label: 'Bu Hafta', start: formatIstanbulDate(weekAgo), end: today },
    { label: 'Bu Ay', start: formatIstanbulDate(monthAgo), end: today },
    { label: 'Bu Yıl', start: `${today.slice(0, 4)}-01-01`, end: today },
  ];
};

const DEPT_ICONS: Record<string, React.ReactNode> = {
  KITCHEN: <ChefHat size={16} />,
  GRILL:   <Flame size={16} />,
  BAR:     <Beer size={16} />,
  PASTRY:  <Cake size={16} />,
  COLD:    <Snowflake size={16} />,
};

const DEPT_LABELS: Record<string, string> = {
  KITCHEN: 'Mutfak',
  GRILL:   'Izgara',
  BAR:     'Bar',
  PASTRY:  'Pastane',
  COLD:    'Soğuk',
};

// Odeme yontemi listeleri ve karma-odeme kirilimi tek kaynakta: @/lib/payments

// ─── Mini SVG Bar Chart (no dependency) ─────────────
function BarChart({ data }: { data: { date: string; revenue: number }[] }) {
  if (!data.length) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:200, color:'var(--text-secondary)', flexDirection:'column', gap:8 }}>
      <Receipt size={40} strokeWidth={1} opacity={0.4} />
      <span style={{ fontSize:'0.875rem' }}>Bu dönemde veri yok</span>
    </div>
  );

  const max = Math.max(...data.map(d => d.revenue));
  const barW = Math.max(20, Math.min(60, Math.floor(580 / data.length) - 8));

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, minWidth: data.length * (barW + 6), height: 200, paddingTop: 8 }}>
        {data.map((d, i) => {
          const pct = max > 0 ? (d.revenue / max) * 100 : 0;
          const label = d.date.slice(5); // MM-DD
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1, minWidth: barW }}>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 700 }}>
                ₺{fmt(d.revenue)}
              </span>
              <div
                title={`${d.date}: ₺${fmt(d.revenue)}`}
                style={{
                  width: '100%', height: `${Math.max(pct, 4)}%`,
                  background: 'linear-gradient(180deg, var(--accent) 0%, #7C3AED 100%)',
                  borderRadius: '6px 6px 2px 2px',
                  transition: 'height 0.5s ease',
                  cursor: 'default',
                  boxShadow: '0 2px 8px rgba(109,40,217,0.3)',
                }}
              />
              <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────
function StatCard({ label, value, sub, icon, color, loading, onClick }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; color: string; loading: boolean; onClick?: () => void;
}) {
  return (
    <div className="card" onClick={onClick} style={{ display:'flex', flexDirection:'column', gap:12, position:'relative', overflow:'hidden', cursor: onClick ? 'pointer' : 'default', transition: 'transform 0.2s', ...(onClick ? { ':hover': { transform: 'scale(1.02)' } } : {}) }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <span style={{ fontSize:'0.8125rem', fontWeight:600, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.05em' }}>{label}</span>
        <span style={{ padding:'8px', borderRadius:10, background: color + '22', color }}>{icon}</span>
      </div>
      {loading
        ? <div className="skeleton" style={{ height:36, width:'60%' }} />
        : <div style={{ fontSize:'2rem', fontWeight:900, color:'var(--text-primary)', lineHeight:1 }}>{value}</div>
      }
      {sub && !loading && <span style={{ fontSize:'0.75rem', color:'var(--text-tertiary)' }}>{sub}</span>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────
export default function ReportsPage() {
  const { socket } = useNotifications();
  const presets = getReportPresets();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [activePreset, setActivePreset] = useState('Bugün');
  const [startDate, setStartDate] = useState(() => formatIstanbulDate(new Date()));
  const [endDate, setEndDate] = useState(() => formatIstanbulDate(new Date()));
  const [summary, setSummary] = useState<any>(null);
  const [revenueChart, setRevenueChart] = useState<any[]>([]);
  const [deptStats, setDeptStats] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [showOrdersModal, setShowOrdersModal] = useState(false);
  const [ordersList, setOrdersList] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<any>(null);
  const [isPrintingZ, setIsPrintingZ] = useState(false);
  const fetchRequestId = useRef(0);
  const toast = useToast();

  const fetchData = useCallback(async (start: string, end: string) => {
    const requestId = ++fetchRequestId.current;
    setLoading(true);
    try {
      const [sumData, revData, deptData] = await Promise.all([
        api.get(`/reports/daily?startDate=${start}&endDate=${end}`),
        api.get(`/reports/revenue?startDate=${start}&endDate=${end}`),
        api.get(`/reports/departments?date=${start}`),
      ]);
      if (requestId === fetchRequestId.current) {
        setSummary(sumData);
        setRevenueChart(revData || []);
        setDeptStats(deptData || {});
      }
    } catch (err) {
      console.error('Rapor yüklenemedi', err);
    } finally {
      if (requestId === fetchRequestId.current) setLoading(false);
    }
  }, []);

  const fetchOrdersForModal = async (startVal?: string, endVal?: string) => {
    setLoadingOrders(true);
    setShowOrdersModal(true);
    try {
      const activeStart = startVal || startDate;
      const activeEnd = endVal || endDate;

      const sumData = await api.get(`/reports/daily?startDate=${activeStart}&endDate=${activeEnd}`);
      const filtered = sumData.recentOrders || [];
      
      // Sort by latest first
      filtered.sort((a:any, b:any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      setOrdersList(filtered);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingOrders(false);
    }
  };

  const handleModalPreset = (preset: ReportPreset) => {
    setActivePreset(preset.label);
    setStartDate(preset.start);
    setEndDate(preset.end);
    fetchData(preset.start, preset.end);
    fetchOrdersForModal(preset.start, preset.end);
  };

  const handleModalCustomApply = () => {
    setActivePreset('Özel');
    fetchData(startDate, endDate);
    fetchOrdersForModal(startDate, endDate);
  };

  useEffect(() => {
    const today = formatIstanbulDate(new Date());
    setActivePreset('Bugün');
    setStartDate(today);
    setEndDate(today);
    void fetchData(today, today);
  }, [fetchData]);

  useEffect(() => {
    if (!socket) return;
    const refreshReports = () => { void fetchData(startDate, endDate); };

    socket.on('order:updated', refreshReports);
    return () => { socket.off('order:updated', refreshReports); };
  }, [socket, fetchData, startDate, endDate]);

  useEffect(() => {
    if (showOrdersModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showOrdersModal]);

  const applyPreset = (preset: ReportPreset) => {
    setActivePreset(preset.label);
    setStartDate(preset.start);
    setEndDate(preset.end);
    fetchData(preset.start, preset.end);
  };

  const applyCustom = () => {
    setActivePreset('Özel');
    fetchData(startDate, endDate);
  };

  /**
   * Z raporunu kasa yazicisina gonderir. Rakamlar sunucuda, ekrandakiyle
   * ayni kaynaktan (reportService) uretilir; burada sadece secili tarih
   * araligi iletilir ki kagit ile ekran ayni donemi gostersin.
   */
  const printZReport = async () => {
    if (isPrintingZ) return;
    setIsPrintingZ(true);
    try {
      const result = await api.post('/printers/print-zreport', {
        startDate,
        endDate,
        rangeLabel: startDate === endDate ? startDate : `${startDate} - ${endDate}`,
      });
      toast.success(`🧾 Z raporu yazıcıya gönderildi → ${result?.printer ?? ''}`);
    } catch (err: any) {
      toast.error(`❌ ${err?.message || 'Z raporu yazdırılamadı'}`);
    } finally {
      setIsPrintingZ(false);
    }
  };

  const exportCsv = () => {
    if (!summary) return;
    const rows: any[] = [
      { 'Bilgi': 'Dönem', 'Değer': `${startDate} — ${endDate}` },
      { 'Bilgi': 'Rapor Tarihi', 'Değer': new Date().toLocaleDateString('tr-TR') },
      { 'Bilgi': '', 'Değer': '' },
      { 'Bilgi': 'Toplam Ciro', 'Değer': `₺${fmt(summary.totalRevenue || 0)}` },
      { 'Bilgi': 'Sipariş Sayısı', 'Değer': summary.totalOrders || 0 },
      { 'Bilgi': 'Ortalama Fiş', 'Değer': `₺${fmt(summary.avgOrderValue || 0)}` },
      { 'Bilgi': '', 'Değer': '' },
      { 'Bilgi': '── EN ÇOK SATANLAR ──', 'Değer': 'ADET | CİRO' },
    ];
    (summary.topSellingItems || []).forEach((item: any, i: number) => {
      rows.push({ 'Bilgi': `${i + 1}. ${item.name}`, 'Değer': `${item.count} adet | ₺${fmt(item.revenue)}` });
    });
    rows.push({ 'Bilgi': '', 'Değer': '' });
    rows.push({ 'Bilgi': '── GARSON PERFORMANSI ──', 'Değer': 'SİPARİŞ | CİRO' });
    (summary.waiterPerformance || []).forEach((w: any) => {
      rows.push({ 'Bilgi': w.name, 'Değer': `${w.orders} sipariş | ₺${fmt(w.revenue)}` });
    });

    downloadCsv(rows, `REST_OTM_Rapor_${startDate}_${endDate}.csv`);
  };

  const maxRevenue = summary?.topSellingItems?.[0]?.revenue || 1;
  const totalDeptRevenue = Object.values(deptStats as Record<string, {revenue:number}>).reduce((s, d) => s + d.revenue, 0);
  
  // Handle older orders where paymentMethod might be null (UNKNOWN) or localized
  const cashRevenue = (summary?.paymentBreakdown?.CASH || 0) + (summary?.paymentBreakdown?.UNKNOWN || 0) + (summary?.paymentBreakdown?.Nakit || 0);
  const cardRevenue = (summary?.paymentBreakdown?.CARD || 0) + (summary?.paymentBreakdown?.['Kredi Kartı'] || 0);
  const yemekSepetiRevenue = summary?.paymentBreakdown?.YEMEK_SEPETI || 0;
  const trendyolGoRevenue = summary?.paymentBreakdown?.TRENDYOL_GO || 0;
  const getirRevenue = summary?.paymentBreakdown?.GETIR || 0;
  const ibanRevenue = summary?.paymentBreakdown?.IBAN || 0;
  const totalPayment = cashRevenue + cardRevenue + yemekSepetiRevenue + trendyolGoRevenue + getirRevenue + ibanRevenue || 1;

  return (
    <div className="animate-fade-in" style={{ display:'flex', flexDirection:'column', gap:28 }}>

      {/* ─── Header ───────────────────────────────────── */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:16, justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <h1 style={{ fontSize:'1.75rem', fontWeight:900, marginBottom:4 }}>Raporlar ve Analizler</h1>
          <p style={{ color:'var(--text-secondary)', fontSize:'0.9375rem' }}>İşletmenizin finansal performans özeti</p>
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
          {/* Presets */}
          <div style={{ display:'flex', gap:6 }}>
            {presets.map(p => (
              <button
                key={p.label}
                onClick={() => applyPreset(p)}
                style={{
                  padding:'8px 16px', borderRadius:10, fontWeight:700, fontSize:'0.875rem', cursor:'pointer',
                  border: activePreset === p.label ? '2px solid var(--accent)' : '1.5px solid var(--border)',
                  background: activePreset === p.label ? 'var(--accent)' : 'var(--bg-surface)',
                  color: activePreset === p.label ? '#fff' : 'var(--text-primary)',
                  transition: 'all 0.2s',
                }}
              >{p.label}</button>
            ))}
          </div>
          {/* Custom Range */}
          <div style={{ display:'flex', alignItems:'center', gap:6, background:'var(--bg-surface)', border:'1.5px solid var(--border)', borderRadius:10, padding:'4px 10px' }}>
            <Calendar size={14} color="var(--text-tertiary)" />
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              style={{ border:'none', background:'transparent', fontSize:'0.8125rem', color:'var(--text-primary)', outline:'none', cursor:'pointer' }} />
            <span style={{ color:'var(--text-tertiary)' }}>–</span>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              style={{ border:'none', background:'transparent', fontSize:'0.8125rem', color:'var(--text-primary)', outline:'none', cursor:'pointer' }} />
            <button onClick={applyCustom}
              style={{ padding:'4px 10px', borderRadius:7, background:'var(--accent)', color:'#fff', border:'none', fontWeight:700, fontSize:'0.75rem', cursor:'pointer' }}>
              Uygula
            </button>
          </div>
          <button onClick={() => fetchData(startDate, endDate)} title="Yenile"
            style={{ padding:'9px', borderRadius:10, background:'var(--bg-elevated)', border:'1.5px solid var(--border)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-primary)' }}>
            <RefreshCcw size={16} />
          </button>
          <button onClick={printZReport} disabled={isPrintingZ} className="btn btn-ghost" style={{ gap:8, display:'flex', alignItems:'center' }} title="Z Raporu Yazdır">
            {isPrintingZ ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />} Z Raporu
          </button>
          <button onClick={exportCsv} className="btn btn-primary" style={{ gap:8, display:'flex', alignItems:'center' }}>
            <Download size={16} /> CSV’ye Aktar
          </button>
        </div>
      </div>

      {/* ─── KPI Cards ────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:16 }}>
        <StatCard loading={loading} label="Toplam Ciro" icon={<TrendingUp size={18} />} color="#6D28D9"
          value={`₺${fmt(summary?.totalRevenue || 0)}`} sub={`${startDate} – ${endDate}`} />
        <StatCard loading={loading} label="Sipariş Sayısı" icon={<ShoppingBag size={18} />} color="#0EA5E9"
          value={fmt(summary?.totalOrders || 0)} sub="Kayıtları görmek için tıklayın" onClick={() => void fetchOrdersForModal()} />
        <StatCard loading={loading} label="Ortalama Fiş" icon={<Receipt size={18} />} color="#10B981"
          value={`₺${fmt(summary?.avgOrderValue || 0)}`} sub="Sipariş başına" />
        <StatCard loading={loading} label="Aktif Garson" icon={<Users size={18} />} color="#F59E0B"
          value={String(summary?.activeWaitersCount || 0)} sub="Sistemde Kayıtlı" />
      </div>

      {/* ─── Revenue Chart ────────────────────────────── */}
      <div className="card">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <h2 style={{ fontSize:'1.125rem', fontWeight:800 }}>Günlük Ciro Grafiği</h2>
          {loading && <Loader2 size={18} className="animate-spin" color="var(--accent)" />}
        </div>
        {loading
          ? <div style={{ height:200, display:'flex', alignItems:'center', justifyContent:'center' }}><Loader2 size={32} className="animate-spin" color="var(--accent)" /></div>
          : <BarChart data={revenueChart} />
        }
      </div>

      {/* ─── Two-Column: Best Sellers + Payment ───────── */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:20 }}>

        {/* En Çok Satanlar */}
        <div className="card">
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
            <Award size={20} color="#F59E0B" />
            <h2 style={{ fontSize:'1.125rem', fontWeight:800 }}>En Çok Satanlar</h2>
          </div>
          {loading ? (
            Array(5).fill(0).map((_, i) => <div key={i} className="skeleton" style={{ height:44, marginBottom:10, borderRadius:10 }} />)
          ) : !summary?.topSellingItems?.length ? (
            <p style={{ color:'var(--text-secondary)', textAlign:'center', padding:'40px 0' }}>Bu dönemde satış verisi bulunamadı.</p>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {summary.topSellingItems.map((item: any, i: number) => {
                const pct = Math.round((item.revenue / maxRevenue) * 100);
                const medals = ['🥇','🥈','🥉'];
                return (
                  <div key={i} style={{ display:'flex', flexDirection:'column', gap:4 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontSize:'1rem' }}>{medals[i] || `${i+1}.`}</span>
                        <span style={{ fontWeight:700, fontSize:'0.9375rem' }}>{item.name}</span>
                      </div>
                      <div style={{ textAlign:'right' }}>
                        <span style={{ fontWeight:900, color:'var(--accent)' }}>₺{fmt(item.revenue)}</span>
                        <span style={{ color:'var(--text-tertiary)', fontSize:'0.8125rem', marginLeft:8 }}>{item.count} adet</span>
                      </div>
                    </div>
                    <div style={{ height:6, borderRadius:99, background:'var(--bg-elevated)', overflow:'hidden' }}>
                      <div style={{ height:'100%', width:`${pct}%`, background:'linear-gradient(90deg, var(--accent), #A78BFA)', borderRadius:99, transition:'width 0.8s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Payment Breakdown + Dept */}
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {/* Ödeme Yöntemi */}
          <div className="card" style={{ flex: 'none' }}>
            <h2 style={{ fontSize:'1rem', fontWeight:800, marginBottom:16 }}>Ödeme Yöntemleri</h2>
            {loading ? (
              <div className="skeleton" style={{ height:80 }} />
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <Banknote size={18} color="#10B981" />
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                      <span style={{ fontWeight:700, fontSize:'0.875rem' }}>Nakit</span>
                      <span style={{ fontWeight:900, color:'#10B981' }}>₺{fmt(cashRevenue)}</span>
                    </div>
                    <div style={{ height:6, borderRadius:99, background:'var(--bg-elevated)' }}>
                      <div style={{ height:'100%', width:`${(cashRevenue / totalPayment) * 100}%`, background:'#10B981', borderRadius:99 }} />
                    </div>
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <CreditCard size={18} color="#0EA5E9" />
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                      <span style={{ fontWeight:700, fontSize:'0.875rem' }}>Kart</span>
                      <span style={{ fontWeight:900, color:'#0EA5E9' }}>₺{fmt(cardRevenue)}</span>
                    </div>
                    <div style={{ height:6, borderRadius:99, background:'var(--bg-elevated)' }}>
                      <div style={{ height:'100%', width:`${(cardRevenue / totalPayment) * 100}%`, background:'#0EA5E9', borderRadius:99 }} />
                    </div>
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <Landmark size={18} color="#0284c7" />
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                      <span style={{ fontWeight:700, fontSize:'0.875rem' }}>IBAN / Havale</span>
                      <span style={{ fontWeight:900, color:'#0284c7' }}>₺{fmt(ibanRevenue)}</span>
                    </div>
                    <div style={{ height:6, borderRadius:99, background:'var(--bg-elevated)' }}>
                      <div style={{ height:'100%', width:`${(ibanRevenue / totalPayment) * 100}%`, background:'#0284c7', borderRadius:99 }} />
                    </div>
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <ShoppingBag size={18} color="#EA004B" />
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                      <span style={{ fontWeight:700, fontSize:'0.875rem' }}>Yemek Sepeti</span>
                      <span style={{ fontWeight:900, color:'#EA004B' }}>₺{fmt(yemekSepetiRevenue)}</span>
                    </div>
                    <div style={{ height:6, borderRadius:99, background:'var(--bg-elevated)' }}>
                      <div style={{ height:'100%', width:`${(yemekSepetiRevenue / totalPayment) * 100}%`, background:'#EA004B', borderRadius:99 }} />
                    </div>
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <ShoppingBag size={18} color="#F27A1A" />
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                      <span style={{ fontWeight:700, fontSize:'0.875rem' }}>Trendyol Go</span>
                      <span style={{ fontWeight:900, color:'#F27A1A' }}>₺{fmt(trendyolGoRevenue)}</span>
                    </div>
                    <div style={{ height:6, borderRadius:99, background:'var(--bg-elevated)' }}>
                      <div style={{ height:'100%', width:`${(trendyolGoRevenue / totalPayment) * 100}%`, background:'#F27A1A', borderRadius:99 }} />
                    </div>
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <ShoppingBag size={18} color="#5D3EBC" />
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                      <span style={{ fontWeight:700, fontSize:'0.875rem' }}>Getir</span>
                      <span style={{ fontWeight:900, color:'#5D3EBC' }}>₺{fmt(getirRevenue)}</span>
                    </div>
                    <div style={{ height:6, borderRadius:99, background:'var(--bg-elevated)' }}>
                      <div style={{ height:'100%', width:`${(getirRevenue / totalPayment) * 100}%`, background:'#5D3EBC', borderRadius:99 }} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bölüm İstatistikleri */}
          <div className="card" style={{ flex: 1, minHeight: 200, display: 'flex', flexDirection: 'column' }}>
            <h2 style={{ fontSize:'1rem', fontWeight:800, marginBottom:16 }}>Bölüm Analizi</h2>
            {loading ? (
              Array(3).fill(0).map((_,i) => <div key={i} className="skeleton" style={{ height:32, marginBottom:8, borderRadius:8 }} />)
            ) : !Object.keys(deptStats).length ? (
              <p style={{ color:'var(--text-secondary)', textAlign:'center', fontSize:'0.875rem' }}>Veri yok</p>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {Object.entries(deptStats as Record<string, {count:number; revenue:number}>)
                  .sort((a,b) => b[1].revenue - a[1].revenue)
                  .map(([dept, stat]) => (
                  <div key={dept} style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ color:'var(--accent)' }}>{DEPT_ICONS[dept] || '📦'}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                        <span style={{ fontWeight:600, fontSize:'0.8125rem' }}>{DEPT_LABELS[dept] || dept}</span>
                        <span style={{ fontWeight:800, fontSize:'0.8125rem', color:'var(--accent)' }}>₺{fmt(stat.revenue)}</span>
                      </div>
                      <div style={{ height:4, borderRadius:99, background:'var(--bg-elevated)' }}>
                        <div style={{ height:'100%', width: totalDeptRevenue > 0 ? `${(stat.revenue / totalDeptRevenue) * 100}%` : '0%', background:'var(--accent)', borderRadius:99 }} />
                      </div>
                    </div>
                    <span style={{ fontSize:'0.75rem', color:'var(--text-tertiary)', minWidth:40, textAlign:'right' }}>{stat.count} ad.</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Personel Performansı ───────────────────────── */}
      {!loading && summary?.waiterPerformance?.length > 0 && (
        <div className="card">
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
            <Users size={20} color="#6D28D9" />
            <h2 style={{ fontSize:'1.125rem', fontWeight:800 }}>Personel Performansı</h2>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.9375rem' }}>
              <thead>
                <tr style={{ borderBottom:'2px solid var(--border)' }}>
                  {['Sıra','Personel','Sipariş Sayısı','Toplam Ciro','Ort. Fiş'].map(h => (
                    <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontWeight:700, color:'var(--text-secondary)', fontSize:'0.8125rem', textTransform:'uppercase', letterSpacing:'0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.waiterPerformance.map((w: any, i: number) => (
                  <tr key={i} style={{ borderBottom:'1px solid var(--border)', transition:'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding:'12px 12px' }}>
                      <span style={{ fontWeight:900, color: i === 0 ? '#F59E0B' : i === 1 ? '#94A3B8' : i === 2 ? '#CD7F32' : 'var(--text-secondary)' }}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}
                      </span>
                    </td>
                    <td style={{ padding:'12px 12px', fontWeight:700 }}>{w.name}</td>
                    <td style={{ padding:'12px 12px', color:'var(--text-secondary)' }}>{w.orders} sipariş</td>
                    <td style={{ padding:'12px 12px', fontWeight:900, color:'var(--accent)' }}>₺{fmt(w.revenue)}</td>
                    <td style={{ padding:'12px 12px', color:'var(--text-secondary)' }}>₺{fmt(w.orders > 0 ? w.revenue / w.orders : 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Orders List Modal */}
      {mounted && showOrdersModal && createPortal(
        <div 
          className="modal-overlay" 
          onClick={() => setShowOrdersModal(false)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backgroundColor: 'rgba(0,0,0,0.4)' }}
        >
          <div className="modal-box" style={{ maxWidth: 600, padding: 0, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowOrdersModal(false)}>
              <X size={18} />
            </button>
            <div className="modal-header" style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <h2 className="modal-title" style={{ fontSize: '1.125rem', marginBottom: 4 }}>Sipariş Kayıtları</h2>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Seçili tarih aralığındaki tamamlanan siparişler</p>
              </div>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                {presets.map(preset => (
                  <button
                    key={preset.label}
                    onClick={() => handleModalPreset(preset)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 20,
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      background: activePreset === preset.label ? 'var(--accent)' : 'var(--bg-elevated)',
                      color: activePreset === preset.label ? '#fff' : 'var(--text-secondary)',
                      border: `1px solid ${activePreset === preset.label ? 'var(--accent)' : 'var(--border)'}`,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Scrollable list */}
            <div className="modal-content-scroll" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {loadingOrders ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 180 }}>
                  <Loader2 size={32} className="animate-spin" color="var(--accent)" />
                </div>
              ) : ordersList.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '60px 20px' }}>
                  <ShoppingBag size={36} style={{ marginBottom: 12, opacity: 0.3 }} />
                  <p style={{ fontWeight: 500 }}>Seçilen tarih aralığında tamamlanmış kayıt bulunamadı.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {ordersList.map(o => {
                    const pb = o.status === 'COMPLETED' ? paymentBreakdown(o) : null;
                    return (
                    <div
                      key={o.id}
                      onClick={() => setSelectedOrderDetails(o)}
                      className="card hover-pop" 
                      style={{ 
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                        padding: '16px 20px', cursor: 'pointer', transition: 'all 0.15s',
                        border: '1px solid var(--border)', background: 'var(--bg-surface)'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '0.9375rem', marginBottom: 4, color: 'var(--text-primary)' }}>
                          {o.type === 'TAKEAWAY' ? `Paket: ${o.customer?.name || '-'}` : `Masa ${o.table?.number || '-'}`}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>#{o.orderNumber}</span>
                          <span>•</span>
                          <span>{new Date(o.createdAt).toLocaleString('tr-TR')}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 900, color: 'var(--text-primary)', fontSize: '1.0625rem', marginBottom: 4 }}>
                          ₺{fmt(o.grandTotal)}
                        </div>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                          <span style={{ 
                            fontSize: '0.6875rem', color: 'var(--text-secondary)', 
                            background: 'var(--bg-elevated)', border: '1px solid var(--border)', 
                            padding: '2px 6px', borderRadius: 4, fontWeight: 700 
                          }}>
                            {pb ? (pb.isMixed ? 'Karma Ödeme' : pb.label) : '-'}
                          </span>
                          {o.status === 'COMPLETED' && (
                            <span style={{
                              fontSize: '0.6875rem', color: '#059669', fontWeight: 800,
                              background: '#D1FAE5', padding: '2px 6px', borderRadius: 4
                            }}>
                              Ödendi
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Order Details Sub-Modal */}
      {mounted && selectedOrderDetails && createPortal(
        <div 
          className="modal-overlay" 
          onClick={() => setSelectedOrderDetails(null)} 
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100000, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', backgroundColor: 'rgba(0,0,0,0.4)' }}
        >
          <div className="modal-box" style={{ maxWidth: 500, padding: 0, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedOrderDetails(null)}>
              <X size={18} />
            </button>
            <div className="modal-header" style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <h3 className="modal-title" style={{ fontSize: '1.125rem', marginBottom: 4 }}>Sipariş Detayı</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>#{selectedOrderDetails.orderNumber} • {new Date(selectedOrderDetails.createdAt).toLocaleString('tr-TR')}</p>
              </div>
            </div>
            
            <div className="modal-content-scroll" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Order Info */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.8125rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Tür:</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{selectedOrderDetails.type === 'TAKEAWAY' ? 'Paket Siparişi' : 'Masa Siparişi'}</span>
                </div>
                {selectedOrderDetails.type === 'DINING' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Masa No:</span>
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Masa {selectedOrderDetails.table?.number || '-'}</span>
                  </div>
                )}
                {selectedOrderDetails.type === 'TAKEAWAY' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Müşteri:</span>
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{selectedOrderDetails.customer?.name || '-'}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Garson:</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{selectedOrderDetails.waiter?.name || '-'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Ödeme Yöntemi:</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)', textAlign: 'right' }}>
                    {selectedOrderDetails.status === 'COMPLETED'
                      ? paymentBreakdown(selectedOrderDetails).label
                      : '-'}
                  </span>
                </div>
              </div>

              {/* Items List */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 900, marginBottom: 12, color: 'var(--text-primary)' }}>Alınan Ürünler</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(() => {
                    const allItems: any[] = [];
                    selectedOrderDetails.subChecks?.forEach((sc: any) => {
                      sc.items?.forEach((item: any) => {
                        allItems.push(item);
                      });
                    });

                    if (allItems.length === 0) {
                      return <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', textAlign: 'center', padding: '12px 0' }}>Ürün kaydı bulunmuyor.</p>;
                    }

                    return allItems.map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8125rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ 
                            background: 'var(--bg-elevated)', border: '1px solid var(--border)', 
                            padding: '2px 6px', borderRadius: 4, fontWeight: 800, fontSize: '0.75rem',
                            color: 'var(--text-primary)'
                          }}>
                            {item.quantity}x
                          </span>
                          <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{item.menuItemName}</span>
                        </div>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>₺{fmt(item.totalPrice)}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>

            {/* Total Footer */}
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 800, fontSize: '0.875rem', color: 'var(--text-primary)' }}>Toplam Tutar</span>
              <span style={{ fontWeight: 900, fontSize: '1.1875rem', color: 'var(--accent)' }}>₺{fmt(selectedOrderDetails.grandTotal)}</span>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
