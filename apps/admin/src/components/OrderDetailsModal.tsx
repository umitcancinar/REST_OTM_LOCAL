'use client';

import React, { useState, useEffect } from 'react';
import { X, Printer, Trash2, CheckCircle, Gift, XCircle, Loader2, Receipt, CreditCard, Banknote, ShoppingBag, Landmark, Minus, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useNotifications } from '@/context/NotificationContext';
import Portal from './ui/Portal';
import { useToast } from './ui/Toast';
import { sendBillPrint, sendStationPrint, sendPaketPrint } from '@/lib/printing';

interface OrderDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: any;
  onRefresh: () => void;
}

export default function OrderDetailsModal({ isOpen, onClose, order: initialOrder, onRefresh }: OrderDetailsModalProps) {
  const [localOrder, setLocalOrder] = useState<any>(initialOrder);
  const [isProcessing, setIsProcessing] = useState(false);
  /** Sunucu yaniti beklenen urunler — ayni urune tekrar basilmasini engeller. */
  const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(new Set());
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isWaitingForPOS, setIsWaitingForPOS] = useState(false);
  const [posStatus, setPosStatus] = useState<string | null>(null);
  const [printingState, setPrintingState] = useState<'stations' | 'bill' | null>(null);
  const [editingQtyItem, setEditingQtyItem] = useState<any>(null);
  const [useDecimal, setUseDecimal] = useState(false);
  const [editQty, setEditQty] = useState(1);

  const { socket } = useNotifications();
  const toast = useToast();

  const [partialAmount, setPartialAmount] = useState<number | string>('');

  // Sync local order when initialOrder changes
  useEffect(() => { setLocalOrder(initialOrder); }, [initialOrder]);

  // Body scroll lock
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  // Listen for POS result
  useEffect(() => {
    if (!socket) return;
    const handlePaymentCompleted = (data: { paymentId: string; success: boolean; message?: string }) => {
      if (!isWaitingForPOS) return;
      if (data.success) {
        handleCompletePayment('CARD');
      } else {
        setIsWaitingForPOS(false);
        setPosStatus(null);
        toast.error(`POS hatası: ${data.message || 'Ödeme başarısız'}`);
      }
    };
    socket.on('payment:completed', handlePaymentCompleted);
    return () => { socket.off('payment:completed', handlePaymentCompleted); };
  }, [socket, isWaitingForPOS]);

  useEffect(() => {
    if (showPaymentModal && localOrder) {
      setPartialAmount(localOrder.grandTotal - (localOrder.paidAmount || 0));
    }
  }, [showPaymentModal, localOrder]);

  if (!isOpen || !localOrder) return null;

  // ─── Print Handlers ──────────────────────────────────────────────
  const handlePrintStations = async () => {
    if (printingState) return;
    setPrintingState('stations');
    try {
      const result = await sendStationPrint(localOrder.id);
      const labels = result.printedStations.map((station) => station === 'KITCHEN' ? 'Fırın' : 'Izgara').join(' + ');
      toast.success(`🖨️ Ürünler ayrıştırıldı → ${labels}`);
    } catch (err: any) {
      toast.error(`❌ ${err?.message || 'Mutfak fişleri yazdırılamadı'}`);
    } finally { setPrintingState(null); }
  };

  const handlePrintBill = async () => {
    if (printingState) return;
    setPrintingState('bill');
    
    try {
      if (localOrder.type === 'TAKEAWAY') {
        await sendPaketPrint(localOrder.id);
        toast.success(`📦 Paket fişi yazıcısına gönderildi`);
      } else {
        const result = await sendBillPrint(localOrder.id);
        toast.success(`🧾 Adisyon yazıcısına gönderildi → ${result.printer}`);
      }
    } catch (err: any) {
      toast.error(`❌ ${err?.message || 'Yazıcıya bağlanılamadı'}`);
    } finally { setPrintingState(null); }
  };

  // ─── Order Item Handlers ─────────────────────────────────────────

  const handleUpdateItemStatus = async (itemId: string, status: string, isTreat: boolean = false) => {
    // Ayni urun icin istek ucarken ikincisini gonderme (mukerrer iptal fisi).
    if (pendingItemIds.has(itemId)) return;
    const previousOrder = { ...localOrder };
    setPendingItemIds(prev => new Set(prev).add(itemId));

    // Optimistic update
    const updatedSubChecks = localOrder.subChecks.map((sc: any) => ({
      ...sc,
      items: sc.items.map((item: any) => {
        if (item.id !== itemId) return item;
        let newPrice = item.totalPrice;
        if (isTreat) newPrice = 0;
        else if (item.isTreat && !isTreat) {
          const extrasTotal = (item.extras || []).reduce((sum: number, e: any) => sum + e.price, 0);
          newPrice = (item.unitPrice * (item.portionMultiplier || 1) + extrasTotal) * item.quantity;
        }
        return {
          ...item,
          status,
          isTreat,
          notes: isTreat ? '[İKRAM]' : item.notes,
          totalPrice: newPrice,
        };
      }),
    }));

    let newGrandTotal = 0;
    const finalSubChecks = updatedSubChecks.map((sc: any) => {
      const activeItems = sc.items.filter((i: any) => i.status !== 'CANCELLED');
      const newSubtotal = activeItems.reduce((sum: number, i: any) => sum + i.totalPrice, 0);
      newGrandTotal += newSubtotal;
      return { ...sc, subtotal: newSubtotal };
    });

    setLocalOrder({ ...localOrder, subChecks: finalSubChecks, grandTotal: newGrandTotal });

    try {
      await api.patch(`/orders/${localOrder.id}/items/${itemId}/status`, {
        status,
        notes: isTreat ? '[İKRAM]' : undefined,
      });
      onRefresh();
    } catch (err: any) {
      setLocalOrder(previousOrder);
      toast.error(err.response?.data?.message || 'İşlem başarısız');
    } finally {
      setPendingItemIds(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  const handleUpdateItemQuantity = async () => {
    if (!editingQtyItem || editQty <= 0) return;
    const itemId = editingQtyItem.id;
    const previousOrder = { ...localOrder };
    const newQty = editQty;

    setEditingQtyItem(null);

    // Ekrani hemen guncelle; istek arka planda devam etsin. Onceden tum
    // pencereyi kapatan bir yukleniyor katmani aciliyor ve kullanici
    // sunucu yanitina kadar bekletiliyordu.
    let optimisticGrandTotal = 0;
    const optimisticSubChecks = localOrder.subChecks.map((sc: any) => {
      const items = sc.items.map((item: any) => {
        if (item.id !== itemId) return item;
        if (item.isTreat) return { ...item, quantity: newQty };
        const extrasTotal = (item.extras || []).reduce((sum: number, e: any) => sum + e.price, 0);
        const unit = item.unitPrice * (item.portionMultiplier || 1) + extrasTotal;
        return { ...item, quantity: newQty, totalPrice: unit * newQty };
      });
      const subtotal = items
        .filter((i: any) => i.status !== 'CANCELLED')
        .reduce((sum: number, i: any) => sum + i.totalPrice, 0);
      optimisticGrandTotal += subtotal;
      return { ...sc, items, subtotal };
    });
    setLocalOrder({ ...localOrder, subChecks: optimisticSubChecks, grandTotal: optimisticGrandTotal });

    try {
      await api.patch(`/orders/${localOrder.id}/items/${itemId}/quantity`, { quantity: newQty });
      onRefresh();
    } catch (err: any) {
      setLocalOrder(previousOrder); // iyimser degisikligi geri al
      toast.error(err.response?.data?.message || 'Miktar güncellenemedi');
    }
  };

  const handleCancelOrder = async () => {
    if (!confirm('Bu siparişi tamamen iptal etmek istediğinize emin misiniz?')) return;
    setIsProcessing(true);
    try {
      await api.delete(`/orders/${localOrder.id}`);
      toast.success('Sipariş iptal edildi');
      onRefresh();
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Sipariş iptal edilemedi');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCompletePayment = async (method: 'CASH' | 'CARD' | 'IBAN' | 'YEMEK_SEPETI' | 'TRENDYOL_GO' | 'GETIR') => {
    setIsProcessing(true);
    try {
      const amountToPay = Number(partialAmount);
      const remainingAmount = localOrder.grandTotal - (localOrder.paidAmount || 0);
      const isFullyPaid = amountToPay >= remainingAmount;

      await api.patch(`/orders/${localOrder.id}/status`, { 
        status: isFullyPaid ? 'COMPLETED' : 'PENDING', 
        paymentMethod: method,
        amount: amountToPay
      });
      setShowPaymentModal(false);
      setIsWaitingForPOS(false);
      setPosStatus(null);
      
      if (isFullyPaid) {
        toast.success('Ödeme alındı, masa kapatıldı');
        onClose();
      } else {
        toast.success(`${amountToPay} TL tahsil edildi.`);
      }
      onRefresh();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Ödeme kaydedilemedi');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTriggerPOS = async () => {
    // Kredi kartı POS yönlendirmesi iptal edildi, nakit gibi direkt ödeme alacak.
    await handleCompletePayment('CARD');
  };

  const items = (localOrder.subChecks?.flatMap((sc: any) => sc.items) || []).filter(Boolean);
  const isCompleted = localOrder.status === 'COMPLETED' || localOrder.status === 'CANCELLED';

  return (
    <Portal>
      <div className="modal-overlay" onClick={onClose}>
        <div
          className="modal-box"
          style={{ maxWidth: 620, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '92vh' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Loading overlay */}
          {isProcessing && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'inherit', backdropFilter: 'blur(4px)' }}>
              <Loader2 className="animate-spin" size={36} color="#fff" />
            </div>
          )}

          {/* Header */}
          <div style={{ padding: '24px 28px 20px', background: 'linear-gradient(135deg, var(--bg-elevated) 0%, var(--bg-surface) 100%)', borderBottom: '1px solid var(--border)', position: 'relative', flexShrink: 0 }}>
            <button
              onClick={onClose}
              style={{ position: 'absolute', top: 20, right: 20, width: 36, height: 36, borderRadius: '50%', background: 'var(--bg-muted)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-secondary)', transition: 'all 0.15s' }}
              onMouseOver={e => { e.currentTarget.style.background = 'var(--accent-danger)'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'var(--accent-danger)'; }}
              onMouseOut={e => { e.currentTarget.style.background = 'var(--bg-muted)'; e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              <X size={16} />
            </button>

            <h2 style={{ fontSize: '1.375rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: 8 }}>
              Sipariş Detayı
            </h2>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.8125rem' }}>
              <span style={{ background: 'var(--bg-muted)', padding: '3px 10px', borderRadius: 20, fontWeight: 700, color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                #{localOrder.orderNumber}
              </span>
              {localOrder.type === 'TAKEAWAY' ? (
                <span className="badge badge-info">📦 Paket</span>
              ) : (
                <span style={{ background: 'var(--bg-muted)', padding: '3px 10px', borderRadius: 20, fontWeight: 700, color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                  🪑 Masa {localOrder.table?.number}
                </span>
              )}
              {localOrder.customer && (
                <span style={{ color: 'var(--text-secondary)' }}>👤 {localOrder.customer.name}</span>
              )}
              {isCompleted && (
                <span className={`badge ${localOrder.status === 'COMPLETED' ? 'badge-success' : 'badge-danger'}`}>
                  {localOrder.status === 'COMPLETED' ? '✅ Tamamlandı' : '❌ İptal'}
                </span>
              )}
            </div>
          </div>

          {/* ─── Printer Action Row ─────────────────────────────── */}
          <div style={{ padding: '16px 28px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: 10 }}>
              Mutfak Yazıcıları
            </p>
            <div style={{ marginBottom: 10 }}>
              <button
                id="btn-print-stations"
                onClick={handlePrintStations}
                disabled={!!printingState}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  padding: '14px 16px', borderRadius: 12, border: 'none', cursor: printingState ? 'not-allowed' : 'pointer',
                  background: printingState === 'stations' ? '#4338ca' : 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                  color: '#fff', fontWeight: 800, fontSize: '0.9375rem',
                  boxShadow: printingState === 'stations' ? 'none' : '0 4px 14px rgba(79,70,229,0.35)',
                  transition: 'all 0.2s', opacity: printingState && printingState !== 'stations' ? 0.5 : 1,
                }}
                onMouseOver={e => { if (!printingState) { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; } }}
                onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.transform = ''; }}
              >
                {printingState === 'stations' ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Printer size={18} />
                )}
                Mutfak Fişlerini Otomatik Yazdır
              </button>
            </div>

            {/* Adisyon — ayrı, bağımsız satır */}
            <button
              id="btn-print-bill"
              onClick={handlePrintBill}
              disabled={!!printingState}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                padding: '12px 16px', borderRadius: 12, border: '2px dashed var(--border)',
                cursor: printingState ? 'not-allowed' : 'pointer',
                background: printingState === 'bill' ? 'var(--bg-muted)' : 'transparent',
                color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.875rem',
                transition: 'all 0.2s', opacity: printingState && printingState !== 'bill' ? 0.5 : 1,
              }}
              onMouseOver={e => { if (!printingState) { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-muted)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; } }}
              onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
            >
              {printingState === 'bill' ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />}
              Adisyon Yazdır
            </button>
          </div>

          {/* ─── Items List ──────────────────────────────────────── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary)' }}>
                <Printer size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                <p>Bu siparişte ürün yok</p>
              </div>
            )}
            {items.map((item: any) => {
              const isCancelled = item.status === 'CANCELLED';
              const isTreat = item.notes?.includes('[İKRAM]') || item.isTreat;

              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex', alignItems: 'center',
                    padding: '12px 14px', borderRadius: 10,
                    background: isCancelled ? 'var(--bg-muted)' : 'var(--bg-surface)',
                    border: `1px solid ${isCancelled ? 'transparent' : 'var(--border)'}`,
                    opacity: isCancelled ? 0.55 : 1,
                    transition: 'all 0.15s',
                    gap: 12,
                  }}
                >
                  {/* Quantity badge */}
                  <button 
                    onClick={() => {
                      if (!isCompleted && !isCancelled) {
                        setEditingQtyItem(item);
                        setEditQty(item.quantity);
                        setUseDecimal(item.quantity % 1 !== 0);
                      }
                    }}
                    disabled={isCompleted || isCancelled}
                    title={!isCompleted && !isCancelled ? "Miktarı Düzenle" : undefined}
                    style={{
                      minWidth: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: isCancelled ? 'var(--border)' : 'var(--accent)', color: '#fff',
                      fontWeight: 900, fontSize: '1rem', flexShrink: 0,
                      border: 'none',
                      cursor: (!isCompleted && !isCancelled) ? 'pointer' : 'default',
                      transition: 'all 0.15s',
                    }}
                    onMouseOver={e => { if (!isCompleted && !isCancelled) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.05)'; }}
                    onMouseOut={e => { if (!isCompleted && !isCancelled) (e.currentTarget as HTMLButtonElement).style.transform = ''; }}
                  >
                    {item.quantity}
                  </button>

                  {/* Name + extras */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9375rem', textDecoration: isCancelled ? 'line-through' : 'none', color: 'var(--text-primary)' }}>
                        {item.menuItemName}
                        {item.portionOption && item.portionOption !== 'Normal' && (
                          <span style={{ fontWeight: 500, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}> ({item.portionOption})</span>
                        )}
                      </span>
                      {isTreat && !isCancelled && <span className="badge badge-warning" style={{ fontSize: '10px' }}>İKRAM</span>}
                      {isCancelled && <span className="badge badge-danger" style={{ fontSize: '10px' }}>İPTAL</span>}
                    </div>
                    {item.notes && !isTreat && !isCancelled && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 3, fontStyle: 'italic' }}>
                        📌 {item.notes}
                      </p>
                    )}
                  </div>

                  {/* Price */}
                  <div style={{ fontWeight: 800, fontSize: '0.9375rem', textDecoration: isCancelled ? 'line-through' : 'none', color: isTreat ? 'var(--success)' : 'var(--text-primary)', flexShrink: 0 }}>
                    {isTreat ? 'İKRAM' : `₺${Number(item.totalPrice).toFixed(2)}`}
                  </div>

                  {/* Item action buttons */}
                  {!isCompleted && !isCancelled && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {!isTreat && (
                        <button
                          title="İkram Yap"
                          onClick={() => handleUpdateItemStatus(item.id, item.status, true)}
                          style={{ width: 30, height: 30, borderRadius: 6, border: 'none', background: 'var(--bg-muted)', cursor: 'pointer', color: 'var(--info)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
                          onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--info)'; (e.currentTarget as HTMLButtonElement).style.color = '#fff'; }}
                          onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-muted)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--info)'; }}
                        >
                          <Gift size={14} />
                        </button>
                      )}
                      <button
                        title="İptal Et"
                        onClick={() => handleUpdateItemStatus(item.id, 'CANCELLED', false)}
                        style={{ width: 30, height: 30, borderRadius: 6, border: 'none', background: 'var(--bg-muted)', cursor: 'pointer', color: 'var(--accent-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
                        onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-danger)'; (e.currentTarget as HTMLButtonElement).style.color = '#fff'; }}
                        onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-muted)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent-danger)'; }}
                      >
                        <XCircle size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ─── Footer ─────────────────────────────────────────── */}
          <div style={{ padding: '16px 28px', background: 'var(--bg-elevated)', borderTop: '2px dashed var(--border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              {localOrder.paidAmount > 0 ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Ara Toplam</span>
                    <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      ₺{Number(localOrder.grandTotal).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--success)' }}>Ödenen</span>
                    <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--success)' }}>
                      ₺{Number(localOrder.paidAmount).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-secondary)' }}>Kalan Tutar</span>
                    <span style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--accent)', letterSpacing: '-0.02em' }}>
                      ₺{(localOrder.grandTotal - localOrder.paidAmount).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Genel Toplam</span>
                  <span style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--accent)', letterSpacing: '-0.02em' }}>
                    ₺{Number(localOrder.grandTotal).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}
            </div>

            {!isCompleted && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button
                  id="btn-complete-order"
                  className="btn btn-primary"
                  style={{ gap: 8, fontWeight: 800, background: 'linear-gradient(135deg, var(--success) 0%, #15803d 100%)', border: 'none', boxShadow: '0 4px 14px rgba(22,163,74,0.3)' }}
                  onClick={() => setShowPaymentModal(true)}
                >
                  <CheckCircle size={16} />
                  Ödeme Al / Kapat
                </button>
                <button
                  id="btn-cancel-order"
                  className="btn btn-ghost"
                  style={{ gap: 8, color: 'var(--accent-danger)', fontWeight: 700 }}
                  onClick={handleCancelOrder}
                >
                  <Trash2 size={16} />
                  Siparişi İptal Et
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Payment Modal ────────────────────────────────────────── */}
      {showPaymentModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(8px)' }}>
          <div className="card animate-scale-in" style={{ width: '100%', maxWidth: 440, padding: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ fontSize: '1.5rem', fontWeight: 900 }}>Ödeme Al</h3>
              <button
                onClick={() => { setShowPaymentModal(false); setIsWaitingForPOS(false); setPosStatus(null); }}
                style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--bg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ textAlign: 'center', marginBottom: 28, padding: '20px', background: 'var(--bg-muted)', borderRadius: 16 }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 8 }}>
                Toplam Kalan: ₺{(localOrder.grandTotal - (localOrder.paidAmount || 0)).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
              </p>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', marginBottom: 8 }}>Tahsil Edilecek Tutar</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <span style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--accent)', letterSpacing: '-0.03em' }}>₺</span>
                <input
                  type="number"
                  value={partialAmount}
                  onChange={(e) => setPartialAmount(e.target.value)}
                  style={{
                    fontSize: '3rem', fontWeight: 900, color: 'var(--accent)', letterSpacing: '-0.03em',
                    background: 'transparent', border: 'none', borderBottom: '2px solid var(--border)',
                    width: '250px', textAlign: 'center', outline: 'none'
                  }}
                />
              </div>
            </div>

            {isWaitingForPOS ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <Loader2 className="animate-spin" size={48} color="var(--accent)" style={{ margin: '0 auto 20px' }} />
                <p style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{posStatus}</p>
                <button
                  className="btn btn-ghost"
                  style={{ marginTop: 20, color: 'var(--accent-danger)' }}
                  onClick={() => { setIsWaitingForPOS(false); setPosStatus(null); }}
                >
                  İşlemi İptal Et
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                <button
                  id="btn-pay-cash"
                  className="btn"
                  style={{ height: 110, flexDirection: 'column', gap: 10, fontSize: '0.9rem', fontWeight: 800, background: 'var(--bg-muted)', border: '2px solid var(--border)', borderRadius: 14, transition: 'all 0.2s' }}
                  onClick={() => handleCompletePayment('CASH')}
                  onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#15803d'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(22,163,74,0.08)'; }}
                  onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-muted)'; }}
                >
                  <Banknote size={28} color="#15803D" />
                  NAKİT
                </button>
                <button
                  id="btn-pay-card"
                  className="btn"
                  style={{ height: 110, flexDirection: 'column', gap: 10, fontSize: '0.9rem', fontWeight: 800, background: 'var(--bg-muted)', border: '2px solid var(--border)', borderRadius: 14, transition: 'all 0.2s' }}
                  onClick={handleTriggerPOS}
                  onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#1D4ED8'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(29,78,216,0.08)'; }}
                  onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-muted)'; }}
                >
                  <CreditCard size={28} color="#1D4ED8" />
                  KREDİ KARTI
                </button>
                <button
                  id="btn-pay-iban"
                  className="btn"
                  style={{ height: 110, flexDirection: 'column', gap: 10, fontSize: '0.9rem', fontWeight: 800, background: 'var(--bg-muted)', border: '2px solid var(--border)', borderRadius: 14, transition: 'all 0.2s' }}
                  onClick={() => handleCompletePayment('IBAN')}
                  onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#0284c7'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(2,132,199,0.08)'; }}
                  onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-muted)'; }}
                >
                  <Landmark size={28} color="#0284c7" />
                  IBAN / HAVALE
                </button>
                <button
                  id="btn-pay-yemek-sepeti"
                  className="btn"
                  style={{ height: 110, flexDirection: 'column', gap: 10, fontSize: '0.9rem', fontWeight: 800, background: 'var(--bg-muted)', border: '2px solid var(--border)', borderRadius: 14, transition: 'all 0.2s' }}
                  onClick={() => handleCompletePayment('YEMEK_SEPETI')}
                  onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#EA004B'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(234,0,75,0.08)'; }}
                  onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-muted)'; }}
                >
                  <ShoppingBag size={28} color="#EA004B" />
                  YEMEK SEPETİ
                </button>
                <button
                  id="btn-pay-trendyol"
                  className="btn"
                  style={{ height: 110, flexDirection: 'column', gap: 10, fontSize: '0.9rem', fontWeight: 800, background: 'var(--bg-muted)', border: '2px solid var(--border)', borderRadius: 14, transition: 'all 0.2s' }}
                  onClick={() => handleCompletePayment('TRENDYOL_GO')}
                  onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#F27A1A'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(242,122,26,0.08)'; }}
                  onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-muted)'; }}
                >
                  <ShoppingBag size={28} color="#F27A1A" />
                  TRENDYOL GO
                </button>
                <button
                  id="btn-pay-getir"
                  className="btn"
                  style={{ height: 110, flexDirection: 'column', gap: 10, fontSize: '0.9rem', fontWeight: 800, background: 'var(--bg-muted)', border: '2px solid var(--border)', borderRadius: 14, transition: 'all 0.2s' }}
                  onClick={() => handleCompletePayment('GETIR')}
                  onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#5D3EBC'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(93,62,188,0.08)'; }}
                  onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-muted)'; }}
                >
                  <ShoppingBag size={28} color="#5D3EBC" />
                  GETİR
                </button>
              </div>
            )}

            <p style={{ marginTop: 24, fontSize: '0.8125rem', color: 'var(--text-tertiary)', textAlign: 'center' }}>
              Ödeme sonrası masa otomatik boşaltılacaktır.
            </p>
          </div>
        </div>
      )}

      {/* ─── Edit Quantity Modal ────────────────────────────────────── */}
      {editingQtyItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 300000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(6px)' }}>
          <div className="card animate-scale-in" style={{ width: '100%', maxWidth: 360, padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 900, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>Miktarı Düzenle</h3>
              <button
                onClick={() => setEditingQtyItem(null)}
                style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--bg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-secondary)', marginBottom: 20 }}>
              {editingQtyItem.menuItemName} <span style={{ fontWeight: 500, fontSize: '0.8125rem' }}>({editingQtyItem.portionOption})</span>
            </p>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Yeni Miktar</span>
              <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-full)', padding: 3, border: '1px solid var(--border-strong)', gap: 3 }}>
                {(['Tam', 'Kesirli'] as const).map((lbl, idx) => (
                  <button
                    key={lbl}
                    onClick={() => {
                      setUseDecimal(idx === 1);
                      if (idx === 1 && editQty % 1 === 0) setEditQty(editQty > 0 ? editQty : 0.25);
                      else if (idx === 0) setEditQty(Math.max(1, Math.round(editQty)));
                    }}
                    style={{
                      padding: '4px 12px', borderRadius: 'var(--radius-full)', border: 'none', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer',
                      background: useDecimal === (idx === 1) ? 'var(--accent)' : 'transparent',
                      color: useDecimal === (idx === 1) ? '#fff' : 'var(--text-secondary)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {useDecimal ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {[0.25, 0.5, 0.75].map((v) => (
                    <button
                      key={v}
                      onClick={() => setEditQty(v)}
                      style={{
                        padding: '12px 6px', borderRadius: 'var(--radius-lg)', border: `2px solid ${editQty === v ? 'var(--accent)' : 'var(--border-strong)'}`,
                        background: editQty === v ? 'var(--accent-muted)' : 'var(--bg-elevated)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, transition: 'all 0.18s'
                      }}
                    >
                      <span style={{ fontSize: '1.25rem', fontWeight: 900, color: editQty === v ? 'var(--accent)' : 'var(--text-primary)', lineHeight: 1 }}>
                        {v === 0.25 ? '¼' : v === 0.5 ? '½' : '¾'}
                      </span>
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'center' }}>
                  <button 
                    onClick={() => setEditQty(v => Math.max(0.25, Math.round((v - 0.25) * 100) / 100))}
                    style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--bg-elevated)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-primary)' }}
                  ><Minus size={18} /></button>
                  <span style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--accent)', minWidth: 56, textAlign: 'center' }}>{editQty}</span>
                  <button 
                    onClick={() => setEditQty(v => Math.round((v + 0.25) * 100) / 100)}
                    style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--bg-elevated)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-primary)' }}
                  ><Plus size={18} /></button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, background: 'var(--bg-elevated)', padding: 6, borderRadius: 'var(--radius-full)', justifyContent: 'center', marginBottom: 24 }}>
                <button 
                  onClick={() => setEditQty(Math.max(1, editQty - 1))}
                  style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--bg-surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-primary)' }}
                ><Minus size={20} /></button>
                <span style={{ fontSize: '1.75rem', fontWeight: 900, width: 52, textAlign: 'center', color: 'var(--text-primary)' }}>{editQty}</span>
                <button 
                  onClick={() => setEditQty(editQty + 1)}
                  style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--bg-surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-primary)' }}
                ><Plus size={20} /></button>
              </div>
            )}

            <button
              className="btn btn-primary"
              style={{ width: '100%', height: 52, borderRadius: 'var(--radius-md)', fontWeight: 800, fontSize: '1rem' }}
              onClick={handleUpdateItemQuantity}
              disabled={isProcessing}
            >
              {isProcessing ? <Loader2 className="animate-spin" size={18} /> : 'Kaydet'}
            </button>
          </div>
        </div>
      )}
    </Portal>
  );
}
