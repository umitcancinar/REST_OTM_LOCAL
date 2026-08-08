'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { 
  ArrowLeft, 
  Printer, 
  Loader2,
  ShoppingBag
} from 'lucide-react';
import styles from '../../order/[tableId]/OrderPage.module.css';
import { sendKitchenPrint, sendGrillPrint, sendBillPrint } from '@/lib/printing';

export default function OrderHistoryPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = params.orderId as string;
  const toast = useToast();

  const [order, setOrder] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPrinting, setIsPrinting] = useState(false);
  const [tenant, setTenant] = useState<any>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [orderData, profile] = await Promise.all([
           api.get(`/orders/${orderId}`),
           api.get('/auth/profile')
        ]);
        
        setOrder(orderData);

        if (profile?.tenant?.settings) {
          const settings = typeof profile.tenant.settings === 'string' 
            ? JSON.parse(profile.tenant.settings) 
            : profile.tenant.settings;
          
          if (settings.printLayouts) {
            setTenant(settings);
          }
        }
      } catch (err: any) {
        console.error('Core data load failed:', err);
        toast.error('Sipariş yüklenirken bir sorun oluştu.');
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [orderId, toast]);

  const handlePrint = async (type: 'TAHSILAT' | 'FIRIN' | 'IZGARA' = 'TAHSILAT') => {
    if (!order) return;
    setIsPrinting(true);
    try {
      if (type === 'TAHSILAT') {
        await sendBillPrint(order.id);
      } else if (type === 'FIRIN') {
        await sendKitchenPrint(order.id);
      } else if (type === 'IZGARA') {
        await sendGrillPrint(order.id);
      }
      toast.success('Yazdırma işlemi başlatıldı.');
    } catch (err) {
      console.error('Print failed:', err);
      toast.error('Yazdırma başarısız oldu.');
    } finally {
      setIsPrinting(false);
    }
  };

  const orderItems = order?.subChecks?.flatMap((sc: any) => sc.items) || [];

  if (isLoading) return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}><Loader2 className="animate-spin" size={48} color="var(--accent)" /></div>;
  if (!order) return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>Sipariş bulunamadı.</div>;

  return (
    <div className={styles.container}>
      
      {/* FULL WIDTH PANEL */}
      <div 
        className={styles.leftPanel}
        style={{ flex: 1, borderRight: 'none' }}
      >
         <div className={styles.leftHeader}>
            <button onClick={() => router.back()} className={styles.backBtn}>
               <ArrowLeft size={24} />
            </button>
            <div className={styles.headerInfo}>
               <h1 className={styles.tableTitle}>Geçmiş Sipariş - {order?.table ? `Masa ${order.table.number}` : (order.type === 'TAKEAWAY' ? 'Paket Sipariş' : 'Bilinmiyor')}</h1>
               <p className={styles.orderNumber}>#{order?.orderNumber}</p>
            </div>
            <div className={styles.headerActions}>
               <button onClick={() => handlePrint('TAHSILAT')} disabled={isPrinting} className={styles.actionCircleBtn} title="Adisyon Yazdır">
                  {isPrinting ? <Loader2 size={20} className="animate-spin" /> : <Printer size={20} />}
               </button>
            </div>
         </div>

         <div className={styles.leftContent} style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
            {!orderItems.length && (
               <div className={styles.emptyState}>
                  <ShoppingBag size={64} strokeWidth={1} />
                  <p style={{ fontWeight: 700, fontSize: '1.125rem' }}>Adisyon boş.</p>
               </div>
            )}

            {orderItems.length > 0 && (
               <div className={styles.section}>
                  <span className={styles.sectionHeader}>Sipariş Ürünleri</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                     {orderItems.map((item: any) => (
                        <div key={item.id} className={styles.orderItem} style={{ opacity: item.status === 'CANCELLED' ? 0.6 : 1 }}>
                           <div className={styles.itemMain}>
                              <div className={styles.itemLabel}>
                                 <span className={styles.itemQty}>{item.quantity}x</span>
                                 <div>
                                   <div className={styles.itemName} style={{ textDecoration: item.status === 'CANCELLED' ? 'line-through' : 'none' }}>
                                     {item.menuItemName}
                                     {item.status === 'CANCELLED' && <span className="badge badge-danger" style={{ fontSize: '10px', padding: '2px 6px', marginLeft: 8 }}>İptal</span>}
                                   </div>
                                   {item.notes && <div style={{ fontSize: '0.75rem', fontStyle: 'italic', color: 'var(--text-tertiary)', marginTop: 2 }}>Not: {item.notes}</div>}
                                 </div>
                              </div>
                              <div className={styles.itemPrice}>
                                ₺{item.status === 'CANCELLED' ? '0' : item.totalPrice.toLocaleString('tr-TR')}
                              </div>
                           </div>
                        </div>
                     ))}
                  </div>
               </div>
            )}
         </div>

         <div className={styles.leftFooter} style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
            <div className={styles.totalRow}>
               <span className={styles.totalLabel}>Genel Toplam</span>
               <span className={styles.totalVal}>₺{order.grandTotal.toLocaleString('tr-TR')}</span>
            </div>
         </div>
      </div>
    </div>
  );
}
