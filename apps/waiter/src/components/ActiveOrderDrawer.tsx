'use client';

import React, { useState } from 'react';
import { X, Ban, Gift, Clock, UtensilsCrossed, ReceiptText, CreditCard, Banknote, Loader2 } from 'lucide-react';
import { useNotifications } from '@/context/NotificationContext';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import PinPadModal from './PinPadModal';
import styles from './ActiveOrderDrawer.module.css';
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from '@/lib/payments';

interface ActiveOrderDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeOrder: any;
  onOrderUpdated: () => void;
}

export default function ActiveOrderDrawer({ isOpen, onClose, activeOrder, onOrderUpdated }: ActiveOrderDrawerProps) {
  const toast = useToast();
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ type: 'CANCEL' | 'COMP' | 'PAYMENT', item?: any } | null>(null);
  
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [partialAmount, setPartialAmount] = useState<number | string>('');
  const [isWaitingForPOS, setIsWaitingForPOS] = useState(false);
  const [posStatus, setPosStatus] = useState<string | null>(null);
  const { socket } = useNotifications();

  React.useEffect(() => {
    if (showPaymentModal && activeOrder) {
      setPartialAmount(activeOrder.grandTotal - (activeOrder.paidAmount || 0));
    }
  }, [showPaymentModal, activeOrder]);

  // Listen for POS result
  React.useEffect(() => {
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

  if (!isOpen) return null;

  const handleOpenPayment = () => {
    setShowPaymentModal(true);
  };

  const handleCompletePayment = async (method: PaymentMethod) => {
    setIsProcessing('PAYMENT');
    try {
      const amountToPay = Number(partialAmount);
      const remainingAmount = activeOrder.grandTotal - (activeOrder.paidAmount || 0);
      const isFullyPaid = amountToPay >= remainingAmount;

      // 1. Kasa yazıcısına adisyon gönder (Sadece tamamen ödenince)
      if (isFullyPaid) {
        try {
          await api.post('/printers/print-bill', { orderId: activeOrder.id });
        } catch(e) {
          console.error('Kasa yazıcı hatası:', e);
        }
      }
      
      // 2. Ödemeyi tamamla ve masayı boşalt veya kısmi ödeme kaydet
      await api.patch(`/orders/${activeOrder.id}/status`, { 
        status: isFullyPaid ? 'COMPLETED' : 'PENDING',
        paymentMethod: method,
        amount: amountToPay
      });
      setShowPaymentModal(false);
      setIsWaitingForPOS(false);
      setPosStatus(null);
      
      if (isFullyPaid) {
        toast.success('Ödeme tamamlandı, adisyon kasaya gönderildi.');
        onClose();
      } else {
        toast.success(`${amountToPay} TL tahsil edildi. Kalan: ${remainingAmount - amountToPay} TL`);
      }
      onOrderUpdated();
    } catch (err: any) {
      toast.error(err.message || 'Ödeme kaydedilemedi.');
    } finally {
      setIsProcessing(null);
    }
  };

  const handleTriggerPOS = async () => {
    await handleCompletePayment('CARD');
  };

  const handleCancelItem = (itemId: string, itemName: string) => {
    setPendingAction({ type: 'CANCEL', item: { id: itemId, name: itemName }});
    setIsPinModalOpen(true);
  };

  const handleCompItem = (itemId: string, itemName: string) => {
    setPendingAction({ type: 'COMP', item: { id: itemId, name: itemName }});
    setIsPinModalOpen(true);
  };

  const onPinSuccess = async (verifiedUser: any) => {
    if (!pendingAction || !activeOrder) return;

    const { type, item } = pendingAction;
    setIsProcessing(item.id);

    try {
      if (type === 'CANCEL') {
        await api.patch(`/orders/${activeOrder.id}/items/${item.id}/status`, { 
          status: 'CANCELLED',
          authorizedBy: verifiedUser.id 
        });
        toast.success(`${item.name} başarıyla iptal edildi.`);
      } else {
        await api.patch(`/orders/${activeOrder.id}/items/${item.id}/status`, { 
          status: 'SERVED', 
          notes: (item.notes ? item.notes + ' ' : '') + '[İKRAM]',
          authorizedBy: verifiedUser.id
        });
        toast.success(`${item.name} ikram olarak işaretlendi.`);
      }
      onOrderUpdated();
    } catch (err: any) {
      toast.error(err.message || 'İşlem başarısız.');
    } finally {
      setIsProcessing(null);
      setPendingAction(null);
    }
  };

  const allItems = activeOrder?.subChecks?.flatMap((sc: any) => sc.items) || [];
  const activeItems = allItems.filter((i: any) => i.status !== 'CANCELLED');
  const cancelledItems = allItems.filter((i: any) => i.status === 'CANCELLED');

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      
      <div className={styles.drawer}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <h2 className={styles.title}>
               <ReceiptText size={24} style={{ color: 'var(--accent)' }} />
               Mevcut Adisyon
            </h2>
            <p className={styles.subtitle}>
              SİPARİŞ: #{activeOrder?.orderNumber}
            </p>
          </div>
          <button onClick={onClose} className={styles.closeBtn}>
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {activeItems.length === 0 ? (
             <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.3 }}>
               <UtensilsCrossed size={64} strokeWidth={1} style={{ marginBottom: '20px' }} />
               <p style={{ fontWeight: 700, fontSize: '1.125rem' }}>Aktif ürün bulunmuyor.</p>
             </div>
          ) : (
            <>
              {activeItems.map((item: any) => (
                <div key={item.id} className={styles.orderItem}>
                   <div className={styles.itemHeader}>
                     <div>
                       <h4 className={styles.itemName}>
                         {item.quantity}x {item.menuItemName}
                       </h4>
                       <div className={styles.itemBadges}>
                         {item.portionOption && item.portionOption !== 'Normal' && (
                           <span className={styles.portionBadge}>{item.portionOption}</span>
                         )}
                         {item.notes?.includes('[İKRAM]') && (
                           <span style={{ fontSize: '0.7rem', background: 'var(--success-bg)', color: 'var(--success)', fontWeight: 800, padding: '2px 8px', borderRadius: 'var(--radius-full)' }}>İKRAM</span>
                         )}
                       </div>
                       
                       {item.notes && !item.notes.includes('[İKRAM]') && (
                         <div className={styles.notesBox}>
                           <span style={{ fontWeight: 800, color: 'var(--accent)', marginRight: '6px' }}>NOT:</span> 
                           {item.notes}
                         </div>
                       )}
                     </div>
                     <span className={styles.itemPrice}>
                       ₺{item.totalPrice.toLocaleString('tr-TR')}
                     </span>
                   </div>

                   <div className={styles.itemFooter}>
                     <div className={styles.statusIndicator}>
                       <Clock size={16} style={{ color: 'var(--accent)' }} /> 
                       {item.status === 'COMPLETED' ? 'Ödendi' : 
                        item.status === 'CANCELLED' ? 'İptal' : 'Bekliyor'}
                     </div>

                     <div className={styles.actionGroup}>
                       <button
                         onClick={() => handleCompItem(item.id, item.menuItemName)}
                         disabled={isProcessing === item.id}
                         className={`${styles.actionBtn} ${styles.compBtn}`}
                       >
                         <Gift size={16} /> İkram
                       </button>

                       <button
                         onClick={() => handleCancelItem(item.id, item.menuItemName)}
                         disabled={isProcessing === item.id}
                         className={`${styles.actionBtn} ${styles.cancelBtn}`}
                       >
                         <Ban size={16} /> İptal
                       </button>
                     </div>
                   </div>
                </div>
              ))}
            </>
          )}

          {cancelledItems.length > 0 && (
            <div className={styles.cancelledSection}>
              <span className={styles.sectionHeader}>
                İptal Edilenler
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {cancelledItems.map((item: any) => (
                  <div key={item.id} className={styles.cancelledItem}>
                    <span style={{ textDecoration: 'line-through', fontWeight: 600 }}>{item.quantity}x {item.menuItemName}</span>
                    <span style={{ fontWeight: 800 }}>İPTAL EDİLDİ</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <PinPadModal
          isOpen={isPinModalOpen}
          onClose={() => setIsPinModalOpen(false)}
          onSuccess={onPinSuccess}
          title={pendingAction?.type === 'CANCEL' ? 'İptal Yetkisi' : 'İkram Yetkisi'}
          description={`${pendingAction?.item?.name} işlemi için yetkili PIN kodunu giriniz.`}
          requiredRole={['OWNER', 'CHEF', 'WAITER']}
        />

        {/* Footer / Total Section */}
        <div style={{ padding: '24px', borderTop: '2px dashed var(--border)', background: 'var(--bg-surface)' }}>
           <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: '20px' }}>
              {(activeOrder?.paidAmount || 0) > 0 ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Ara Toplam</span>
                    <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>₺{activeOrder?.grandTotal?.toLocaleString('tr-TR')}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--success)' }}>Ödenen</span>
                    <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--success)' }}>₺{activeOrder?.paidAmount?.toLocaleString('tr-TR')}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                    <span style={{ fontSize: '1.125rem', fontWeight: 800 }}>Kalan Tutar</span>
                    <span style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--accent)' }}>₺{(activeOrder?.grandTotal - activeOrder?.paidAmount)?.toLocaleString('tr-TR')}</span>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '1.125rem', fontWeight: 800 }}>Toplam Tutar</span>
                  <span style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--accent)' }}>₺{activeOrder?.grandTotal?.toLocaleString('tr-TR')}</span>
                </div>
              )}
           </div>
           
           <button 
             onClick={handleOpenPayment}
             style={{ 
               width: '100%', padding: '16px', borderRadius: 'var(--radius-xl)', 
               background: 'var(--accent)', color: 'white', border: 'none',
               fontWeight: 800, fontSize: '1.125rem', display: 'flex', alignItems: 'center', 
               justifyContent: 'center', gap: 10, boxShadow: '0 4px 12px rgba(239, 68, 68, 0.2)'
             }}
           >
              <ReceiptText size={22} /> ÖDEME AL / MASAYI KAPAT
           </button>
        </div>

        {/* PAYMENT MODAL (Internal to Drawer for simplicity) */}
        {showPaymentModal && (
           <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(8px)' }}>
              <div style={{ width: '100%', maxWidth: 360, background: 'var(--bg-surface)', borderRadius: 'var(--radius-2xl)', padding: 32 }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 900 }}>Ödeme Al</h3>
                    <button onClick={() => { setShowPaymentModal(false); setIsWaitingForPOS(false); }} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)' }}><X size={24} /></button>
                 </div>

                 <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', marginBottom: 4 }}>
                      Toplam Kalan: ₺{(activeOrder?.grandTotal - (activeOrder?.paidAmount || 0))?.toLocaleString('tr-TR')}
                    </p>
                    <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', marginBottom: 4, marginTop: 10 }}>Tahsil Edilecek Tutar</p>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      <span style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--accent)' }}>₺</span>
                      <input
                        type="number"
                        value={partialAmount}
                        onChange={(e) => setPartialAmount(e.target.value)}
                        style={{
                          fontSize: '2.5rem', fontWeight: 900, color: 'var(--accent)',
                          background: 'transparent', border: 'none', borderBottom: '2px solid var(--border)',
                          width: '250px', textAlign: 'center', outline: 'none'
                        }}
                      />
                    </div>
                  </div>

                  {isWaitingForPOS ? (
                     <div style={{ textAlign: 'center', padding: '12px 0' }}>
                        <Loader2 className="animate-spin" size={40} color="var(--accent)" style={{ margin: '0 auto 16px' }} />
                        <p style={{ fontWeight: 700, fontSize: '0.9375rem' }}>{posStatus}</p>
                        <button 
                          onClick={() => setIsWaitingForPOS(false)}
                          style={{ marginTop: 20, background: 'none', border: 'none', color: 'var(--accent-danger)', fontWeight: 700 }}
                        >
                           İptal Et
                        </button>
                     </div>
                  ) : (
                     <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
                        {PAYMENT_METHOD_OPTIONS.map(method => {
                           const PaymentIcon = method.icon;
                           return (
                              <button
                                 key={method.key}
                                 onClick={() => handleCompletePayment(method.key)}
                                 style={{ minHeight: 104, padding: '12px 8px', borderRadius: 'var(--radius-xl)', border: '2px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9, fontWeight: 800, fontSize: '0.78rem', color: 'var(--text-primary)', textAlign: 'center', cursor: 'pointer' }}
                              >
                                 <div style={{ padding: 10, background: method.bg, borderRadius: 12 }}><PaymentIcon size={22} color={method.color} /></div>
                                 {method.label}
                              </button>
                           );
                        })}
                     </div>
                  )}
               </div>
            </div>
         )}
      </div>
    </>
  );
}
