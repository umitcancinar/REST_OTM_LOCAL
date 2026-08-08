'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { 
  ArrowLeft, Plus, Minus, Send, Settings2, X, Trash2, Loader2, Edit3, ShoppingBag,
  Printer, ChefHat, CreditCard, Banknote, Smartphone, Package, Save
} from 'lucide-react';
import { sendPaketPrint, sendStationPrint } from '@/lib/printing';
import OrderItemModal from '@/components/OrderItemModal';
import DynamicResizer from '@/components/DynamicResizer';
import styles from './page.module.css';

const PAYMENT_OPTIONS = [
  { key: 'CASH',          label: 'Nakit',          icon: '💵', color: '#22c55e' },
  { key: 'CARD',          label: 'Kart',           icon: '💳', color: '#3b82f6' },
  { key: 'IBAN',          label: 'Havale/EFT',     icon: '🏦', color: '#8b5cf6' },
  { key: 'YEMEK_SEPETI', label: 'Yemek Sepeti',   icon: '🛵', color: '#f97316' },
  { key: 'TRENDYOL_GO',  label: 'Trendyol Go',    icon: '🧡', color: '#f43f5e' },
  { key: 'GETIR',        label: 'Getir',           icon: '🟣', color: '#7c3aed' },
];

export default function TakeawayPage() {
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState<'CUSTOMER' | 'ORDER'>('CUSTOMER');

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  // Ödeme tipi
  const [paymentMethod, setPaymentMethod] = useState<string>('');
  
  // Menu states
  const [categories, setCategories] = useState<any[]>([]);
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [menuViewMode, setMenuViewMode] = useState<'CATEGORIES' | 'PRODUCTS'>('CATEGORIES');
  
  // Cart states
  const [cart, setCart] = useState<any[]>([]);
  const [selectedMenuItem, setSelectedMenuItem] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  
  // Sipariş tamamlandıktan sonra aksiyon durumu
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [postSubmitLoading, setPostSubmitLoading] = useState<{ kitchen: boolean; paket: boolean }>({ kitchen: false, paket: false });

  // Customer database for suggestions
  const [allCustomers, setAllCustomers] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredCustomers, setFilteredCustomers] = useState<any[]>([]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Takeaway Printer Settings
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [autoPrint, setAutoPrint] = useState(false);
  const [selectedPrinterId, setSelectedPrinterId] = useState<string>('');
  const [printers, setPrinters] = useState<any[]>([]);

  // Mobile layout
  const [isMobile, setIsMobile] = useState(false);
  const [leftPanelHeight, setLeftPanelHeight] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleResize = (clientY: number) => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const newHeight = clientY - containerRect.top;
    const minH = 150;
    const maxH = containerRect.height - 150;
    if (newHeight >= minH && newHeight <= maxH) setLeftPanelHeight(newHeight);
  };

  useEffect(() => {
    const savedAutoPrint = localStorage.getItem('takeaway_autoprint') === 'true';
    const savedPrinterId = localStorage.getItem('takeaway_printer_id') || '';
    setAutoPrint(savedAutoPrint);
    setSelectedPrinterId(savedPrinterId);
  }, []);

  const saveSettings = (ap: boolean, pid: string) => {
    localStorage.setItem('takeaway_autoprint', String(ap));
    localStorage.setItem('takeaway_printer_id', pid);
    setAutoPrint(ap);
    setSelectedPrinterId(pid);
    setIsSettingsOpen(false);
  };

  useEffect(() => {
    async function loadData() {
      try {
        const [catData, mData, custData, printerData] = await Promise.all([
          api.get('/menu/categories'),
          api.get('/menu/items'),
          api.get('/customers'),
          api.get('/printers')
        ]);
        setCategories(catData);
        setMenuItems(mData);
        setAllCustomers(custData);
        setPrinters(printerData);
        
        if (catData.length > 0) setActiveCategory(catData[0].id);
      } catch (err) {
         toast.error('Veriler yüklenirken hata oluştu.');
      } finally {
         setIsLoading(false);
      }
    }
    loadData();
  }, [toast]);

  const currentItems = menuItems.filter(item => item.categoryId === activeCategory);
  
  const handleAddToCartConfirm = (customizedItem: any) => {
    setCart(prev => {
      const existingIdx = prev.findIndex(i => 
        i.id === customizedItem.menuItemId && i.portionOption === customizedItem.portionOption && i.notes === customizedItem.notes
      );
      if (existingIdx >= 0) {
        const newCart = [...prev];
        newCart[existingIdx] = { ...newCart[existingIdx], qty: newCart[existingIdx].qty + customizedItem.qty };
        return newCart;
      }
      return [...prev, {
        cartItemId: customizedItem.cartItemId,
        id: customizedItem.menuItemId,
        name: customizedItem.name,
        price: customizedItem.price,
        qty: customizedItem.qty,
        portionOption: customizedItem.portionOption,
        portionMultiplier: customizedItem.portionMultiplier,
        notes: customizedItem.notes
      }];
    });
    setIsModalOpen(false);
    toast.success(`${customizedItem.name} eklendi`);
  };

  const updateCartQty = (cartItemId: string, action: 'increment' | 'decrement') => {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.cartItemId === cartItemId) {
            let newQty = i.qty;
            if (action === 'increment') {
              if (newQty < 1) newQty += 0.25;
              else if (newQty < 2) newQty += 0.5;
              else newQty += 1;
            } else {
              if (newQty <= 0.25) newQty = 0;
              else if (newQty <= 1) newQty -= 0.25;
              else if (newQty <= 2) newQty -= 0.5;
              else newQty -= 1;
            }
            return { ...i, qty: newQty };
          }
          return i;
        })
        .filter((i) => i.qty > 0)
    );
  };

  const handleRemoveFromCart = (cartItemId: string) => {
    setCart((prev) => prev.filter((i) => i.cartItemId !== cartItemId));
    setItemToDelete(null);
    toast.success('Ürün sepetten silindi.');
  };

  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);

  const handleSubmit = async (skipPrint: boolean = false) => {
    if (!customerName.trim()) return toast.warning('Lütfen müşteri adı giriniz.');
    if (cart.length === 0) return toast.warning('Sepet boş.');

    setIsSubmitting(true);
    try {
       const mappedItems = cart.map(c => ({
          menuItemId: c.id,
          quantity: c.qty,
          portionOption: c.portionOption,
          portionMultiplier: c.portionMultiplier,
          notes: c.notes
       }));

       const newOrder = await api.post('/orders', {
          type: 'TAKEAWAY',
          printToKitchen: !skipPrint, // Otomatik mutfağa dağıt (skipPrint false ise)
          customerName: customerName,
          customerPhone: customerPhone,
          customerAddress: customerAddress,
          notes: notes,
          subChecks: [
             { label: 'Paket Sipariş', items: mappedItems }
          ]
       });

       toast.success(`Sipariş başarıyla oluşturuldu${!skipPrint ? ' ve mutfağa iletildi' : ''}!`);
       setCreatedOrderId(newOrder.id);

       // Otomatik paket fişi yazdırma (ayarlarda açıksa ve skipPrint false ise)
       if (autoPrint && !skipPrint) {
         try {
           await sendPaketPrint(newOrder.id, selectedPrinterId || undefined, paymentMethod || undefined);
           toast.success('Paket fişi yazıcıya gönderildi');
         } catch (printError: any) {
           toast.error(printError?.message || 'Paket yazıcısına bağlanılamadı');
         }
       }
       // Sipariş oluştuktan sonra sayfada kal — butonlar görünsün
       setIsSubmitting(false);
       return;
    } catch (err) {
       toast.error('Sipariş oluşturulamadı');
    } finally {
       setIsSubmitting(false);
    }
  };

  // Sipariş oluştuktan sonra mutfağa manuel dağıt
  const handleManualKitchenDistribute = async () => {
    if (!createdOrderId) return;
    setPostSubmitLoading(p => ({ ...p, kitchen: true }));
    try {
      await sendStationPrint(createdOrderId);
      toast.success('Sipariş mutfağa dağıtıldı');
    } catch (err: any) {
      // BAR_ONLY siparisler icin gracefully handle
      if (err?.message?.includes('BAR') || err?.message?.includes('BAR_ONLY') || err?.message?.includes('Siparisde')) {
        toast.info('Sadece içecek var — mutfak fişi gerekmez');
      } else {
        toast.error(err?.message || 'Mutfağa gönderilemedi');
      }
    } finally {
      setPostSubmitLoading(p => ({ ...p, kitchen: false }));
    }
  };

  // Sipariş oluştuktan sonra paket fişi yazdır
  const handleManualPaketPrint = async () => {
    if (!createdOrderId) return;
    setPostSubmitLoading(p => ({ ...p, paket: true }));
    try {
      await sendPaketPrint(createdOrderId, selectedPrinterId || undefined, paymentMethod || undefined);
      toast.success('Paket fişi yazıcıya gönderildi');
    } catch (err: any) {
      toast.error(err?.message || 'Paket yazıcısına bağlanılamadı');
    } finally {
      setPostSubmitLoading(p => ({ ...p, paket: false }));
    }
  };

  // Yeni sipariş aç
  const handleNewOrder = () => {
    setCreatedOrderId(null);
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setNotes('');
    setPaymentMethod('');
    setStep('CUSTOMER');
  };


  const handleSelectCustomer = (customer: any) => {
    setCustomerName(customer.name);
    setCustomerPhone(customer.phone);
    setCustomerAddress(customer.address);
    setShowSuggestions(false);
  };

  useEffect(() => {
    const searchStr = (customerName || customerPhone).trim();
    if (searchStr.length > 0 && showSuggestions) {
      const filtered = allCustomers.filter(c => 
        (c.name && c.name.toLocaleLowerCase('tr-TR').includes(searchStr.toLocaleLowerCase('tr-TR'))) ||
        (c.phone && c.phone.includes(searchStr))
      ).slice(0, 5);
      setFilteredCustomers(filtered);
    } else {
      setFilteredCustomers([]);
    }
  }, [customerName, customerPhone, allCustomers, showSuggestions]);

  if (isLoading) return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}><Loader2 className="animate-spin" size={48} color="var(--accent)" /></div>;

  // Sipariş oluştuktan sonra aksiyon ekranı
  if (createdOrderId) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, background: 'var(--bg-base)'
      }}>
        <div style={{
          background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)',
          padding: 40, maxWidth: 480, width: '100%',
          boxShadow: 'var(--shadow-xl)', textAlign: 'center'
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'var(--success-light)', color: 'var(--success)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px'
          }}>
            <Package size={36} />
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 4px' }}>Sipariş Oluşturuldu!</h2>
          <div style={{ fontSize: '0.875rem', color: 'var(--success)', fontWeight: 600, marginBottom: 16 }}>
            ✓ Mutfak fişi otomatik yazdırıldı
          </div>
          <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)', marginBottom: 32 }}>
            <strong>{customerName}</strong> — {customerPhone || 'Telefon yok'}
            {paymentMethod && (
              <span style={{
                display: 'inline-block', marginLeft: 8,
                background: 'var(--accent-light)', color: 'var(--accent)',
                borderRadius: 6, padding: '2px 10px', fontWeight: 700, fontSize: '0.875rem'
              }}>
                {PAYMENT_OPTIONS.find(p => p.key === paymentMethod)?.label || paymentMethod}
              </span>
            )}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              onClick={handleManualKitchenDistribute}
              disabled={postSubmitLoading.kitchen}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                height: 52, borderRadius: 'var(--radius-md)', border: '2px solid var(--warning)',
                background: 'var(--warning-light)', color: 'var(--warning)',
                fontSize: '1rem', fontWeight: 700, cursor: 'pointer', width: '100%'
              }}
            >
              {postSubmitLoading.kitchen ? <Loader2 className="animate-spin" size={20} /> : <ChefHat size={20} />}
              Tekrar Mutfağa Dağıt
            </button>

            <button
              onClick={handleManualPaketPrint}
              disabled={postSubmitLoading.paket}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                height: 52, borderRadius: 'var(--radius-md)', border: '2px solid var(--accent)',
                background: 'var(--accent-light)', color: 'var(--accent)',
                fontSize: '1rem', fontWeight: 700, cursor: 'pointer', width: '100%'
              }}
            >
              {postSubmitLoading.paket ? <Loader2 className="animate-spin" size={20} /> : <Printer size={20} />}
              Paket Fişi Yazdır
            </button>

            <button
              onClick={() => router.push('/orders')}
              style={{
                height: 44, borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--text-secondary)', fontSize: '0.9375rem',
                fontWeight: 600, cursor: 'pointer', width: '100%'
              }}
            >
              Siparişlere Git
            </button>

            <button
              onClick={handleNewOrder}
              style={{
                height: 52, borderRadius: 'var(--radius-md)',
                border: 'none', background: 'var(--accent)',
                color: '#fff', fontSize: '1rem',
                fontWeight: 700, cursor: 'pointer', width: '100%'
              }}
            >
              + Yeni Paket Siparişi
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {step === 'CUSTOMER' && (
        <div className={styles.customerStepContainer}>
          <div className={styles.customerCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>Müşteri Bilgileri</h1>
              <button 
                className="btn btn-ghost" 
                onClick={() => setIsSettingsOpen(true)}
                style={{ padding: '8px', background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
              >
                <Settings2 size={20} />
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ position: 'relative' }}>
                   <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, display: 'block' }}>Müşteri Adı Soyadı</label>
                   <input 
                     className="input" 
                     placeholder="İsim giriniz..." 
                     value={customerName} 
                     onChange={e => { setCustomerName(e.target.value); setShowSuggestions(true); }}
                     onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                     autoComplete="off"
                     style={{ height: 48, fontSize: '1rem' }}
                   />
                   
                   {showSuggestions && filteredCustomers.length > 0 && (
                     <div style={{
                       position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                       background: 'var(--bg-surface)', border: '1px solid var(--border)',
                       borderRadius: 'var(--radius-md)', marginTop: 4, boxShadow: 'var(--shadow-lg)',
                       overflow: 'hidden'
                     }}>
                        {filteredCustomers.map(c => (
                          <div 
                            key={c.id}
                            onClick={() => handleSelectCustomer(c)}
                            style={{ 
                              padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                            }}
                            className="hover-bg"
                          >
                             <div>
                               <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</div>
                               <div style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)' }}>{c.phone}</div>
                               {c.orders && c.orders.length > 0 && (
                                 <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 6, padding: '6px', background: 'var(--bg-base)', borderRadius: 4, border: '1px dashed var(--border)' }}>
                                   <div style={{ fontWeight: 600, marginBottom: 2 }}>Son Sipariş: {new Date(c.orders[0].createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                                   <div style={{ fontStyle: 'italic', opacity: 0.8, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                     {c.orders[0].subChecks?.[0]?.items?.map((i: any) => `${i.quantity}x ${i.menuItemName}`).join(', ')}
                                   </div>
                                 </div>
                               )}
                             </div>
                             <Plus size={16} style={{ color: 'var(--accent)' }} />
                          </div>
                        ))}
                     </div>
                   )}
                </div>
               <div>
                  <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, display: 'block' }}>Telefon Numarası</label>
                  <input 
                    className="input" 
                    placeholder="05xx..." 
                    value={customerPhone} 
                    onChange={e => { setCustomerPhone(e.target.value); setShowSuggestions(true); }}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    autoComplete="off"
                    style={{ height: 48, fontSize: '1rem' }}
                  />
               </div>
               <div>
                  <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, display: 'block' }}>Teslimat Adresi</label>
                  <textarea 
                    className="input" 
                    placeholder="Adres giriniz..." 
                    value={customerAddress} 
                    onChange={e => setCustomerAddress(e.target.value)}
                    rows={3}
                    style={{ resize: 'none', fontSize: '1rem' }}
                  />
               </div>

               {/* ÖDEME TİPİ SEÇİMİ */}
               <div>
                 <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10, display: 'block' }}>
                   Ödeme Yöntemi
                 </label>
                 <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                   {PAYMENT_OPTIONS.map(opt => (
                     <button
                       key={opt.key}
                       type="button"
                       onClick={() => setPaymentMethod(prev => prev === opt.key ? '' : opt.key)}
                       style={{
                         display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                         gap: 4, padding: '10px 6px',
                         borderRadius: 'var(--radius-md)',
                         border: paymentMethod === opt.key ? `2px solid ${opt.color}` : '2px solid var(--border)',
                         background: paymentMethod === opt.key ? `${opt.color}18` : 'var(--bg-elevated)',
                         cursor: 'pointer',
                         transition: 'all 0.15s',
                         fontSize: '0.75rem', fontWeight: 600,
                         color: paymentMethod === opt.key ? opt.color : 'var(--text-secondary)',
                       }}
                     >
                       <span style={{ fontSize: '1.25rem' }}>{opt.icon}</span>
                       <span>{opt.label}</span>
                     </button>
                   ))}
                 </div>
               </div>
               
               <button 
                 className="btn btn-primary"
                 style={{ height: 52, fontSize: '1.125rem', fontWeight: 700, marginTop: 8 }}
                 onClick={() => {
                   if (!customerName.trim()) {
                     toast.warning('Müşteri adı boş olamaz.');
                     return;
                   }
                   setStep('ORDER');
                 }}
               >
                 Devam Et
               </button>
            </div>
          </div>
        </div>
      )}

      {step === 'ORDER' && (
        <div className={styles.container} ref={containerRef}>
          {/* LEFT PANEL */}
          <div
            className={styles.leftPanel}
            style={isMobile && leftPanelHeight ? { height: `${leftPanelHeight}px`, flex: 'none' } : {}}
          >
            <div className={styles.leftHeader}>
              <button onClick={() => setStep('CUSTOMER')} className={styles.backBtn} title="Müşteri Bilgilerine Dön">
                <ArrowLeft size={24} />
              </button>
              <div className={styles.headerInfo}>
                <h1 className={styles.tableTitle}>
                  {customerName}
                </h1>
                <p className={styles.orderNumber}>
                  {customerPhone || 'Telefon Girilmedi'}
                  {paymentMethod && (
                    <span style={{
                      marginLeft: 8,
                      background: 'var(--accent-light)', color: 'var(--accent)',
                      borderRadius: 4, padding: '1px 7px', fontSize: '0.75rem', fontWeight: 700
                    }}>
                      {PAYMENT_OPTIONS.find(p => p.key === paymentMethod)?.icon} {PAYMENT_OPTIONS.find(p => p.key === paymentMethod)?.label}
                    </span>
                  )}
                </p>
              </div>

              <div className={styles.headerActions}>
                <button
                  onClick={() => setStep('CUSTOMER')}
                  className={styles.actionCircleBtn}
                  title="Düzenle"
                >
                  <Edit3 size={20} />
                </button>
              </div>
            </div>

            <div className={styles.leftContent}>
              {!cart.length && (
                <div className={styles.emptyState}>
                  <ShoppingBag size={64} strokeWidth={1} />
                  <p style={{ fontWeight: 700, fontSize: '1.125rem' }}>Sepet boş.</p>
                  <p style={{ fontSize: '0.875rem' }}>Yan taraftaki menüden ürün seçebilirsiniz.</p>
                </div>
              )}

              {cart.length > 0 && (
                <div className={styles.section}>
                  <span className={`${styles.sectionHeader} ${styles.sectionTitleWarning}`}>
                    Sepet (Paket)
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {cart.map((item) => (
                      <div key={item.cartItemId} className={styles.newOrderItem}>
                        <div>
                          <div className={styles.itemName}>{item.name}</div>
                          {item.portionOption && item.portionOption !== 'Normal' && (
                            <div
                              style={{
                                fontSize: '0.75rem',
                                color: 'var(--accent)',
                                fontWeight: 700,
                                marginTop: 2,
                              }}
                            >
                              {item.portionOption}
                            </div>
                          )}
                          {item.notes && (
                            <div
                              style={{
                                fontSize: '0.75rem',
                                fontStyle: 'italic',
                                color: 'var(--text-tertiary)',
                                marginTop: 2,
                              }}
                            >
                              Not: {item.notes}
                            </div>
                          )}
                          <div
                            style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, marginTop: 4 }}
                          >
                            ₺{item.price.toLocaleString('tr-TR')}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <button
                            className="qty-btn"
                            style={{ width: 36, height: 36, fontSize: 20 }}
                            onClick={() => updateCartQty(item.cartItemId, 'decrement')}
                          >
                            -
                          </button>
                          <span
                            style={{
                              fontWeight: 900,
                              minWidth: 28,
                              textAlign: 'center',
                              fontSize: '1.25rem',
                            }}
                          >
                            {item.qty}
                          </span>
                          <button
                            className="qty-btn"
                            style={{ width: 36, height: 36, fontSize: 20 }}
                            onClick={() => updateCartQty(item.cartItemId, 'increment')}
                          >
                            +
                          </button>
                          <button
                            onClick={() => handleRemoveFromCart(item.cartItemId)}
                            style={{
                              width: 36,
                              height: 36,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: 'var(--danger-light)',
                              color: 'var(--danger)',
                              borderRadius: 'var(--radius-md)',
                              border: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Notes inside scroll area */}
                  <div style={{ paddingTop: 24 }}>
                     <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8, display: 'block', textTransform: 'uppercase' }}>Genel Sipariş Notu</label>
                     <textarea 
                       className="input" 
                       placeholder="Örn: Zili çalmayın..." 
                       value={notes} 
                       onChange={e => setNotes(e.target.value)} 
                       rows={2} 
                       style={{ width: '100%', resize: 'none' }} 
                     />
                  </div>
                </div>
              )}
            </div>

            <div className={styles.leftFooter}>
              <div className={styles.totalRow}>
                <span className={styles.totalLabel}>Toplam Tutar</span>
                <span className={styles.totalVal}>₺{cartTotal.toLocaleString('tr-TR')}</span>
              </div>
              {cart.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button onClick={() => handleSubmit(false)} disabled={isSubmitting} className={styles.submitBtn}>
                    {isSubmitting ? (
                      <Loader2 className="animate-spin" size={24} />
                    ) : (
                      <>
                        <Send size={24} /> PAKET SİPARİŞİ TAMAMLA
                      </>
                    )}
                  </button>
                  <button 
                    onClick={() => handleSubmit(true)} 
                    disabled={isSubmitting} 
                    className={styles.submitBtn} 
                    style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', fontSize: '0.9rem', padding: '0.6rem' }}
                  >
                    {isSubmitting ? (
                      <Loader2 className="animate-spin" size={20} />
                    ) : (
                      <>
                        <Save size={20} style={{ marginRight: '8px' }} /> YAZDIRMADAN KAYDET
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* DYNAMIC RESIZER */}
          {isMobile && <DynamicResizer onResize={handleResize} />}

          {/* RIGHT PANEL */}
          <div className={styles.rightPanel}>
            <div className={styles.rightHeader}>
              {menuViewMode === 'PRODUCTS' && (
                <button
                  onClick={() => setMenuViewMode('CATEGORIES')}
                  className={styles.backBtn}
                  style={{ width: 36, height: 36 }}
                >
                  <ArrowLeft size={18} />
                </button>
              )}
              <h2 className={styles.menuTitle}>
                {menuViewMode === 'CATEGORIES'
                  ? 'MENÜ KATEGORİ'
                  : categories.find((c) => c.id === activeCategory)?.name}
              </h2>
            </div>

            <div className={styles.rightContent}>
              {menuViewMode === 'CATEGORIES' ? (
                <div className={styles.categoryGrid}>
                  {categories.map((cat) => (
                    <div
                      key={cat.id}
                      onClick={() => {
                        setActiveCategory(cat.id);
                        setMenuViewMode('PRODUCTS');
                      }}
                      className={styles.categoryCard}
                    >
                      {cat.name}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {currentItems.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => { setSelectedMenuItem(item); setIsModalOpen(true); }}
                      className={styles.productCard}
                    >
                      <div className={styles.productName}>{item.name}</div>
                      <div className={styles.productPrice}>
                        ₺{item.basePrice.toLocaleString('tr-TR')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Item Config Modal */}
      <OrderItemModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        menuItem={selectedMenuItem}
        onAdd={handleAddToCartConfirm}
      />

      {/* PRINTER SETTINGS MODAL */}
      {isSettingsOpen && (
        <div className="modal-backdrop" onClick={() => setIsSettingsOpen(false)}>
           <div className="modal-content" style={{ maxWidth: 400, padding: 32 }} onClick={e => e.stopPropagation()}>
             <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: 24 }}>Paket Yazıcı Ayarları</h3>
             <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                   <input type="checkbox" checked={autoPrint} onChange={e => setAutoPrint(e.target.checked)} style={{ width: 20, height: 20 }} />
                   <span style={{ fontSize: '1rem', fontWeight: 600 }}>Sipariş gelince otomatik yazdır</span>
                </label>
                {autoPrint && (
                  <div>
                    <label style={{ fontSize: '0.875rem', fontWeight: 600, display: 'block', marginBottom: 8 }}>Yazıcı Seçin</label>
                    <select className="input" value={selectedPrinterId} onChange={e => setSelectedPrinterId(e.target.value)}>
                       <option value="">Varsayılan Yazıcı</option>
                       {printers.map(p => (
                         <option key={p.id} value={p.id}>{p.name}</option>
                       ))}
                    </select>
                  </div>
                )}
                <button className="btn btn-primary" onClick={() => saveSettings(autoPrint, selectedPrinterId)}>
                  Kaydet
                </button>
             </div>
           </div>
        </div>
      )}
    </>
  );
}
