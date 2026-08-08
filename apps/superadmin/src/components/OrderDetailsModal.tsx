import React, { useState, useEffect } from 'react';
import { X, Receipt, Printer, Settings2, Trash2, CheckCircle, RefreshCcw, Gift, XCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useNotifications } from '@/context/NotificationContext';
import Portal from './ui/Portal';
import { CreditCard, Banknote } from 'lucide-react';

interface OrderDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: any;
  onRefresh: () => void;
}

export default function OrderDetailsModal({ isOpen, onClose, order: initialOrder, onRefresh }: OrderDetailsModalProps) {
  const [localOrder, setLocalOrder] = useState<any>(initialOrder);
  const [isProcessing, setIsProcessing] = useState(false);
  const [tenant, setTenant] = useState<any>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isWaitingForPOS, setIsWaitingForPOS] = useState(false);
  const [posStatus, setPosStatus] = useState<string | null>(null);
  const { socket } = useNotifications();

  useEffect(() => {
    async function fetchTenant() {
      try {
        const userProfile = await api.get('/auth/profile');
        if (userProfile?.tenant?.settings) {
          const settings = typeof userProfile.tenant.settings === 'string'
            ? JSON.parse(userProfile.tenant.settings)
            : userProfile.tenant.settings;
          setTenant(settings);
        }
      } catch (err) {
        console.error('Failed to fetch tenant settings', err);
      }
    }
    fetchTenant();
  }, []);

  // Sync local order when initialOrder changes (from parent)
  useEffect(() => {
    setLocalOrder(initialOrder);
  }, [initialOrder]);

  // Listen for POS result
  useEffect(() => {
    if (!socket) return;

    const handlePaymentCompleted = (data: { paymentId: string, success: boolean, message?: string }) => {
      if (isWaitingForPOS) {
        if (data.success) {
          handleCompletePayment('CARD');
        } else {
          setIsWaitingForPOS(false);
          setPosStatus(`Hata: ${data.message || 'Ödeme başarısız'}`);
          setTimeout(() => setPosStatus(null), 5000);
        }
      }
    };

    socket.on('payment:completed', handlePaymentCompleted);
    return () => {
      socket.off('payment:completed', handlePaymentCompleted);
    };
  }, [socket, isWaitingForPOS]);

  // Body scroll lock
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  if (!isOpen || !localOrder) return null;

  const handleUpdateItemStatus = async (itemId: string, status: string, isTreat: boolean = false) => {
    // 1. Save backup for rollback
    const previousOrder = { ...localOrder };

    // 2. OPTIMISTIC UPDATE: Update local state immediately
    const updatedSubChecks = localOrder.subChecks.map((sc: any) => ({
      ...sc,
      items: sc.items.map((item: any) => {
        if (item.id === itemId) {
          const newStatus = status;
          const newIsTreat = isTreat;
          const newNotes = isTreat ? '[İKRAM]' : item.notes;
          
          // Calculate new price for this specific item optimistically
          let newPrice = item.totalPrice;
          if (isTreat) newPrice = 0;
          else if (item.isTreat && !isTreat) {
              // Revert treat
              const extrasTotal = (item.extras || []).reduce((sum: number, e: any) => sum + e.price, 0);
              newPrice = (item.unitPrice * (item.portionMultiplier || 1) + extrasTotal) * item.quantity;
          }

          return { ...item, status: newStatus, isTreat: newIsTreat, notes: newNotes, totalPrice: newPrice };
        }
        return item;
      })
    }));

    // Recalculate totals optimistically
    let newGrandTotal = 0;
    const finalSubChecks = updatedSubChecks.map((sc: any) => {
      const activeItems = sc.items.filter((i: any) => i.status !== 'CANCELLED');
      const newSubtotal = activeItems.reduce((sum: number, i: any) => sum + i.totalPrice, 0);
      newGrandTotal += newSubtotal;
      return { ...sc, subtotal: newSubtotal };
    });

    setLocalOrder({ ...localOrder, subChecks: finalSubChecks, grandTotal: newGrandTotal });

    // 3. API CALL
    try {
      let notes = undefined;
      if (isTreat) notes = '[İKRAM]';

      await api.patch(`/orders/${localOrder.id}/items/${itemId}/status`, { status, notes });
      // Refresh parent to sync with real data
      onRefresh();
    } catch (err: any) {
      // 4. ROLLBACK
      setLocalOrder(previousOrder);
      const msg = err.response?.data?.message || 'İşlem başarısız';
      alert(msg);
    }
  };

  const handleCancelOrder = async () => {
    if (confirm('Bu siparişi tamamen silmek (iptal etmek) istediğinize emin misiniz?')) {
      setIsProcessing(true);
      try {
        await api.delete(`/orders/${localOrder.id}`);
        onRefresh();
        onClose();
      } catch (err: any) {
        const msg = err.response?.data?.message || 'Sipariş iptal edilemedi';
        alert(msg);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handlePrint = async (type: 'TAHSILAT' | 'MUTFAK' | 'MANGAL' | 'PAKET' = 'TAHSILAT') => {
    try {
      const endpoint = type === 'MUTFAK'
        ? '/printers/print-kitchen'
        : type === 'MANGAL'
        ? '/printers/print-grill'
        : type === 'PAKET'
        ? '/printers/print-paket'
        : '/printers/print-bill';
      const result = await api.post(endpoint, { orderId: localOrder.id });
      if (result?.queued) throw new Error(result.error || 'Yazıcı agentı veya yazıcı yanıt vermedi.');
      alert(`✅ Yazdırma komutu gönderildi → ${result?.printer || 'Yazıcı'}`);
    } catch (err: any) {
      alert(`❌ Yazdırma hatası: ${err.message || 'Bilinmeyen hata'}`);
    }
  };

  const handleCompletePayment = async (method: 'CASH' | 'CARD') => {
    setIsProcessing(true);
    try {
      await api.patch(`/orders/${localOrder.id}/status`, { 
        status: 'COMPLETED',
        paymentMethod: method 
      });
      setShowPaymentModal(false);
      setIsWaitingForPOS(false);
      setPosStatus(null);
      onRefresh();
      onClose();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Ödeme kaydedilemedi';
      alert(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTriggerPOS = async () => {
    setIsWaitingForPOS(true);
    setPosStatus('POS cihazına bağlanılıyor...');
    try {
      await api.post('/pos/start-payment', { 
        orderId: localOrder.id,
        amount: localOrder.grandTotal
      });
      setPosStatus('POS cihazında işlem bekleniyor. Kartı okutun...');
    } catch (err: any) {
      setIsWaitingForPOS(false);
      setPosStatus(null);
      alert(err.response?.data?.message || 'POS tetiklenemedi');
    }
  };

  const items = localOrder.subChecks?.flatMap((sc: any) => sc.items) || [];

  return (
    <Portal>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-box" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>

          {isProcessing && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'inherit' }}>
              <Loader2 className="animate-spin" size={32} color="var(--accent)" />
            </div>
          )}

          <div className="modal-header">
            <div>
              <h2 className="modal-title">Sipariş Detayı</h2>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                <span><strong style={{ color: 'var(--text-primary)' }}>N:</strong> {localOrder.orderNumber}</span>
                {localOrder.type === 'TAKEAWAY' ? (
                  <span className="badge badge-info">Paket</span>
                ) : (
                  <span><strong style={{ color: 'var(--text-primary)' }}>Masa:</strong> {localOrder.table?.number}</span>
                )}
                {localOrder.customer && <span><strong style={{ color: 'var(--text-primary)' }}>Müş:</strong> {localOrder.customer.name}</span>}
              </div>
            </div>
          </div>

          {/* Status Actions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid var(--border)' }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => handlePrint('TAHSILAT')}><Printer size={16} /> Adisyon Yazdır</button>
            <button className="btn btn-primary" style={{ flex: 1, background: 'var(--success)', border: 'none' }} onClick={() => setShowPaymentModal(true)}><CheckCircle size={16} /> Ödeme Al / Kapat</button>
            <button className="btn btn-ghost" style={{ flex: 1, color: 'var(--accent-danger)' }} onClick={handleCancelOrder}><Trash2 size={16} /> Siparişi İptal Et</button>
          </div>

          {/* Items List */}
          <div className="modal-content-scroll">
            {items.map((item: any) => {
              const isCancelled = item.status === 'CANCELLED';
              const isTreat = item.notes?.includes('[İKRAM]') || item.isTreat;

              return (
                <div key={item.id} style={{ 
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                  padding: '12px 16px', background: 'var(--bg-surface)', borderRadius: 8, 
                  marginBottom: 8, border: '1px solid var(--border)',
                  opacity: isCancelled ? 0.6 : 1,
                  transition: 'all 0.2s ease'
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 800 }}>{item.quantity}x</span>
                      <span style={{ fontWeight: 600, textDecoration: isCancelled ? 'line-through' : 'none' }}>
                        {item.menuItemName} {item.portionOption !== 'Normal' ? `(${item.portionOption})` : ''}
                      </span>
                      {isTreat && !isCancelled && <span className="badge badge-warning" style={{ fontSize: '10px', padding: '2px 6px' }}>İKRAM</span>}
                      {isCancelled && <span className="badge badge-danger" style={{ fontSize: '10px', padding: '2px 6px' }}>İPTAL</span>}
                    </div>
                    {item.notes && !isTreat && <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>Not: {item.notes}</p>}
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ fontWeight: 900, textDecoration: isCancelled ? 'line-through' : 'none' }}>
                      ₺{item.totalPrice}
                    </div>

                    {/* Actions for Item */}
                    <div style={{ display: 'flex', gap: 6 }}>
                      {!isCancelled && !isTreat && (
                        <button 
                          title="İkram Yap"
                          onClick={() => handleUpdateItemStatus(item.id, item.status, true)}
                          style={{ border: 'none', background: 'var(--bg-muted)', width: 28, height: 28, borderRadius: 4, cursor: 'pointer', color: 'var(--info)' }}
                        >
                          <Gift size={14} />
                        </button>
                      )}
                      {!isCancelled && (
                        <button 
                          title="Ürünü İptal Et"
                          onClick={() => handleUpdateItemStatus(item.id, 'CANCELLED', false)}
                          style={{ border: 'none', background: 'var(--bg-muted)', width: 28, height: 28, borderRadius: 4, cursor: 'pointer', color: 'var(--accent-danger)' }}
                        >
                          <XCircle size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: '2px dashed var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '1.25rem', fontWeight: 800 }}>Genel Toplam</span>
            <span style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--accent)' }}>₺{localOrder.grandTotal}</span>
          </div>

        </div>
      </div>

      {/* PAYMENT MODAL */}
      {showPaymentModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(8px)' }}>
           <div className="card animate-scale-in" style={{ width: '100%', maxWidth: 450, padding: 32 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                 <h3 style={{ fontSize: '1.5rem', fontWeight: 900 }}>Ödeme Al</h3>
                 <button onClick={() => { setShowPaymentModal(false); setIsWaitingForPOS(false); }} className="btn btn-ghost" style={{ padding: 8 }}><X size={24} /></button>
              </div>

              <div style={{ textAlign: 'center', marginBottom: 32 }}>
                 <p style={{ color: 'var(--text-tertiary)', fontSize: '0.9375rem', marginBottom: 8 }}>Tahsil Edilecek Tutar</p>
                 <h2 style={{ fontSize: '3rem', fontWeight: 900, color: 'var(--accent)' }}>₺{localOrder.grandTotal}</h2>
              </div>

              {isWaitingForPOS ? (
                 <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <Loader2 className="animate-spin" size={48} color="var(--accent)" style={{ margin: '0 auto 20px' }} />
                    <p style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{posStatus}</p>
                    <button 
                      className="btn btn-ghost" 
                      style={{ marginTop: 24, color: 'var(--accent-danger)' }}
                      onClick={() => setIsWaitingForPOS(false)}
                    >
                       İşlemi İptal Et
                    </button>
                 </div>
              ) : (
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <button 
                       className="btn" 
                       style={{ height: 120, flexDirection: 'column', gap: 12, fontSize: '1.125rem', fontWeight: 800, background: 'var(--bg-muted)', border: '1px solid var(--border)' }}
                       onClick={() => handleCompletePayment('CASH')}
                    >
                       <Banknote size={32} color="#15803D" />
                       NAKİT
                    </button>
                    <button 
                       className="btn" 
                       style={{ height: 120, flexDirection: 'column', gap: 12, fontSize: '1.125rem', fontWeight: 800, background: 'var(--bg-muted)', border: '1px solid var(--border)' }}
                       onClick={handleTriggerPOS}
                    >
                       <CreditCard size={32} color="#1D4ED8" />
                       KREDİ KARTI
                    </button>
                 </div>
              )}

              <p style={{ marginTop: 32, fontSize: '0.8125rem', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                 Ödeme alındıktan sonra masa otomatik olarak boşaltılacaktır.
              </p>
           </div>
        </div>
      )}
    </Portal>
  );

}
