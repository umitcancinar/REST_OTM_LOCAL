'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import {
  ArrowLeft,
  Printer,
  Send,
  Loader2,
  ShoppingBag,
  Trash2,
  MoreVertical,
  ArrowRightLeft,
  Info,
  StickyNote,
  Receipt,
  UtensilsCrossed,
  X,
  Banknote,
  CreditCard,
  Landmark,
  DollarSign,
  AlertCircle,
  Clock,
  CheckCircle2,
  CheckCheck,
  Save,
} from 'lucide-react';
import OrderItemModal from '@/components/OrderItemModal';
import TableTransferModal from '@/components/TableTransferModal';
import PinPadModal from '@/components/PinPadModal';
import ConfirmModal from '@/components/ConfirmModal';
import DynamicResizer from '@/components/DynamicResizer';
import styles from './OrderPage.module.css';
import { sendStationPrint, sendBillPrint } from '@/lib/printing';

import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from '@/lib/payments';

/**
 * Bir urunun durumunu siparis nesnesi icinde YERINDE gunceller.
 * Sunucu yanitini beklemeden ekrani guncellemek icin kullanilir; istek
 * basarisiz olursa cagiran taraf eski nesneyi geri koyar.
 */
function applyItemStatusLocally(order: any, itemId: string, status: string, notes?: string) {
  if (!order?.subChecks) return order;
  const isTreat = Boolean(notes?.includes('[İKRAM]'));
  return {
    ...order,
    subChecks: order.subChecks.map((sc: any) => ({
      ...sc,
      items: (sc.items || []).map((item: any) => {
        if (item.id !== itemId) return item;
        return {
          ...item,
          status,
          ...(notes !== undefined ? { notes } : {}),
          ...(isTreat ? { isTreat: true, totalPrice: 0 } : {}),
        };
      }),
    })),
  };
}

export default function OrderPage() {
  const router = useRouter();
  const params = useParams();
  const tableId = params.tableId as string;
  const toast = useToast();

  const [activeCategory, setActiveCategory] = useState<string>('');
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [menuItems, setMenuItems] = useState<any[]>([]);

  const [cart, setCart] = useState<any[]>([]);
  const [isCartLoaded, setIsCartLoaded] = useState(false);

  // Load cart from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`waiter_cart_${tableId}`);
      if (saved) {
        try { setCart(JSON.parse(saved)); } catch (e) {}
      }
      setIsCartLoaded(true);
    }
  }, [tableId]);

  // Save cart to localStorage
  useEffect(() => {
    if (isCartLoaded) {
      if (cart.length > 0) {
        localStorage.setItem(`waiter_cart_${tableId}`, JSON.stringify(cart));
      } else {
        localStorage.removeItem(`waiter_cart_${tableId}`);
      }
    }
  }, [cart, tableId, isCartLoaded]);

  const [selectedMenuItem, setSelectedMenuItem] = useState<any>(null);
  const [isItemConfigModalOpen, setIsItemConfigModalOpen] = useState(false);
  const [isLoadingMenu, setIsLoadingMenu] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeOrder, setActiveOrder] = useState<any>(null);
  const [tableInfo, setTableInfo] = useState<any>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isTransferPinOpen, setIsTransferPinOpen] = useState(false);
  const [menuViewMode, setMenuViewMode] = useState<'CATEGORIES' | 'PRODUCTS'>('CATEGORIES');
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [isCancelOrderModalOpen, setIsCancelOrderModalOpen] = useState(false);

  // ── 3-dot menu state ──
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);

  // ── Print options modal ──
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isPrinting, setIsPrinting] = useState<'stations' | 'bill' | null>(null);

  // ── Table note modal ──
  const [isTableNoteOpen, setIsTableNoteOpen] = useState(false);
  const [tableNote, setTableNote] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);

  // ── Table info modal ──
  const [isTableInfoOpen, setIsTableInfoOpen] = useState(false);

  // ── Payment Modal ──
  /** Sunucu yaniti beklenen urunler — ayni urune tekrar basilmasini engeller. */
  const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(new Set());
  /** Tum siparis iptali ucusta mi — mukerrer iptal istegini engeller. */
  const [isCancellingOrder, setIsCancellingOrder] = useState(false);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isWaitingForPOS, setIsWaitingForPOS] = useState(false);
  const [posStatus, setPosStatus] = useState<string | null>(null);
  const [partialAmount, setPartialAmount] = useState<string>('');

  const handleCompletePayment = async (method: PaymentMethod) => {
    if (!activeOrder) return;
    try {
      const amountToPay = Number(partialAmount);
      const remainingAmount = activeOrder.grandTotal - (activeOrder.paidAmount || 0);
      const isFullyPaid = amountToPay >= remainingAmount;

      await api.patch(`/orders/${activeOrder.id}/status`, { 
        status: isFullyPaid ? 'COMPLETED' : 'PENDING', 
        paymentMethod: method,
        amount: amountToPay
      });
      setShowPaymentModal(false);
      setIsPrintModalOpen(false); // Close the print modal if open
      
      if (isFullyPaid) {
        toast.success('Ödeme tamamlandı, masa kapatıldı');
        router.push('/tables');
      } else {
        toast.success('Kısmi ödeme alındı');
        fetchActiveOrder(); // Refresh active order to show updated amounts
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Ödeme tamamlanamadı');
    }
  };

  const [isMobile, setIsMobile] = useState(false);
  const [leftPanelHeight, setLeftPanelHeight] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close 3-dot menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setIsActionsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchActiveOrder = async () => {
    try {
      const isPaket = tableId.startsWith('paket-');
      if (isPaket) {
        const allOrders = await api.get('/orders');
        const paketName = `Paket ${tableId.split('-')[1]}`;
        const active = allOrders.find((o: any) => o.type === 'TAKEAWAY' && !['COMPLETED', 'CANCELLED'].includes(o.status) && (o.customer?.name === paketName || o.customerName === paketName));
        setActiveOrder(active || null);
      } else {
        const active = await api.get(`/orders/active/${tableId}`);
        setActiveOrder(active);
      }
    } catch {
      /* no active order */
    }
  };

  useEffect(() => {
    async function loadData() {
      try {
        const isPaket = tableId.startsWith('paket-');
        const [cats, items, allOrders, table] = await Promise.all([
          api.get('/menu/categories'),
          api.get('/menu/items'),
          isPaket ? api.get('/orders') : api.get(`/orders/active/${tableId}`).catch(() => null),
          isPaket ? Promise.resolve({ id: tableId, number: `Paket ${tableId.split('-')[1]}`, zone: 'Paket Siparişler' }) : api.get(`/tables/${tableId}`),
        ]);
        setCategories(cats);
        setMenuItems(items);

        let active = isPaket ? null : allOrders;
        if (isPaket && allOrders) {
          const paketName = `Paket ${tableId.split('-')[1]}`;
          active = allOrders.find((o: any) => o.type === 'TAKEAWAY' && !['COMPLETED', 'CANCELLED'].includes(o.status) && (o.customer?.name === paketName || o.customerName === paketName));
        }

        setActiveOrder(active);
        setTableInfo(table);
        if (table?.note) setTableNote(table.note);
      } catch (err: any) {
        toast.error('Veriler yüklenirken bir sorun oluştu.');
      } finally {
        setIsLoadingMenu(false);
      }
    }
    loadData();
  }, [tableId]);

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

  // ── Print handlers ──────────────────────────────────────────────
  const handlePrintStations = async () => {
    if (!activeOrder || isPrinting) return;
    setIsPrinting('stations');
    try {
      const result = await sendStationPrint(activeOrder.id);
      const labels = result.printedStations
        .map((s) => (s === 'KITCHEN' ? 'Fırın' : 'Izgara'))
        .join(' + ');
      toast.success(`Ürünler otomatik ayrıştırıldı: ${labels}`);
      setIsPrintModalOpen(false);
    } catch (err: any) {
      toast.error(err?.message || 'Mutfak fişleri yazdırılamadı.');
    } finally {
      setIsPrinting(null);
    }
  };

  const handlePrintBill = async () => {
    if (!activeOrder || isPrinting) return;
    setIsPrinting('bill');
    try {
      await sendBillPrint(activeOrder.id);
      toast.success('Adisyon yazıcıya gönderildi.');
      setIsPrintModalOpen(false);
    } catch (err: any) {
      toast.error(err?.message || 'Adisyon yazıcısına bağlanılamadı.');
    } finally {
      setIsPrinting(null);
    }
  };

  // ── Table note save ──────────────────────────────────────────────
  const handleSaveNote = async () => {
    setIsSavingNote(true);
    try {
      await api.patch(`/tables/${tableId}`, { note: tableNote });
      toast.success('Masa notu kaydedildi.');
      setIsTableNoteOpen(false);
    } catch {
      toast.error('Not kaydedilemedi.');
    } finally {
      setIsSavingNote(false);
    }
  };

  const currentItems = menuItems.filter((item) => item.categoryId === activeCategory);
  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const pageTotal = (activeOrder?.grandTotal || 0) + cartTotal;

  const addToCartFromMenu = (item: any) => {
    setSelectedMenuItem(item);
    setIsItemConfigModalOpen(true);
  };

  const handleAddToCartConfirm = (customizedItem: any) => {
    setCart((prev) => {
      const existingIdx = prev.findIndex(
        (i) =>
          i.id === customizedItem.menuItemId &&
          i.portionOption === customizedItem.portionOption &&
          i.notes === customizedItem.notes
      );
      if (existingIdx >= 0) {
        const newCart = [...prev];
        newCart[existingIdx] = { ...newCart[existingIdx], qty: newCart[existingIdx].qty + customizedItem.qty };
        return newCart;
      }
      return [
        ...prev,
        {
          cartItemId: customizedItem.cartItemId,
          id: customizedItem.menuItemId,
          name: customizedItem.name,
          price: customizedItem.price,
          qty: customizedItem.qty,
          portionOption: customizedItem.portionOption,
          portionMultiplier: customizedItem.portionMultiplier,
          notes: customizedItem.notes,
        },
      ];
    });
    setIsItemConfigModalOpen(false);
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
              if (newQty <= 0.25) newQty = 0; // 0 will delete it
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

  const handleUpdateItemStatus = async (itemId: string, status: string, notes?: string) => {
    if (!activeOrder) return;
    // Ayni urun icin istek ucarken ikinci bir istek gonderme. Yavas yanit
    // sirasinda ust uste basilinca mukerrer iptal/ikram fisi cikiyordu.
    if (pendingItemIds.has(itemId)) return;

    const previousOrder = activeOrder;
    setPendingItemIds(prev => new Set(prev).add(itemId));
    // Ekrani hemen guncelle; istek arka planda devam etsin.
    setActiveOrder((prev: any) => applyItemStatusLocally(prev, itemId, status, notes));

    try {
      await api.patch(`/orders/${activeOrder.id}/items/${itemId}/status`, { status, notes });
      // Sunucudaki nihai hali (yeniden hesaplanan toplamlar dahil) al.
      await fetchActiveOrder();
    } catch {
      setActiveOrder(previousOrder); // iyimser degisikligi geri al
      toast.error('İşlem gerçekleştirilemedi');
    } finally {
      setPendingItemIds(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  const handleCancelOrder = async () => {
    if (!activeOrder || isCancellingOrder) return;
    // Butonu aninda pasiflestir: yavas yanitta ust uste basilip ayni siparis
    // icin birden fazla iptal istegi gitmesini engeller.
    setIsCancellingOrder(true);
    try {
      await api.patch(`/orders/${activeOrder.id}/status`, { status: 'CANCELLED' });
      toast.success('Sipariş iptal edildi.');
      router.push('/orders');
    } catch {
      toast.error('Sipariş iptal edilemedi.');
      setIsCancellingOrder(false); // basarisizsa tekrar denenebilsin
    }
  };

  const executeSubmitOrder = async (skipPrint: boolean = false) => {
    setIsSubmitting(true);
    try {
      const mappedItems = cart.map((c) => ({
        menuItemId: c.id,
        quantity: c.qty,
        portionOption: c.portionOption,
        portionMultiplier: c.portionMultiplier,
        notes: c.notes,
      }));
      const isPaket = tableId.startsWith('paket-');
      await api.post('/orders', {
        type: isPaket ? 'TAKEAWAY' : 'DINE_IN',
        tableId: isPaket ? undefined : tableId,
        customerName: isPaket ? `Paket ${tableId.split('-')[1]}` : undefined,
        subChecks: [{ label: 'Ana Hesap', items: mappedItems }],
        printToKitchen: !skipPrint,
      });
      toast.success(`Sipariş başarıyla eklendi${!skipPrint ? ' ve mutfağa iletildi' : ''}`);
      setCart([]);
      await fetchActiveOrder();
    } catch {
      toast.error('Hata oluştu');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitOrder = (skipPrint: boolean = false) => {
    if (cart.length === 0) {
      toast.error('Lütfen gönderilecek ürün ekleyin.');
      return;
    }
    void executeSubmitOrder(skipPrint);
  };

  const activeOrderItems = activeOrder?.subChecks?.flatMap((sc: any) => sc.items) || [];

  if (isLoadingMenu)
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="animate-spin" size={48} color="var(--accent)" />
      </div>
    );

  return (
    <div className={styles.container} ref={containerRef}>
      {/* LEFT PANEL */}
      <div
        className={styles.leftPanel}
        style={isMobile && leftPanelHeight ? { height: `${leftPanelHeight}px`, flex: 'none' } : {}}
      >
        <div className={styles.leftHeader}>
          <button onClick={() => router.back()} className={styles.backBtn}>
            <ArrowLeft size={24} />
          </button>
          <div className={styles.headerInfo}>
            <h1 className={styles.tableTitle}>
              Masa {activeOrder?.table?.number || tableInfo?.number || '...'}
            </h1>
            <p className={styles.orderNumber}>
              {activeOrder?.orderNumber ? `#${activeOrder.orderNumber}` : 'YENİ SİPARİŞ'}
            </p>
          </div>

          <div className={styles.headerActions}>
            {/* Print button — mutfak/adisyon fişi seçenekleri */}
            {activeOrder && (
              <button
                onClick={() => setIsPrintModalOpen(true)}
                className={styles.actionCircleBtn}
                title="Yazdır"
              >
                <Printer size={20} />
              </button>
            )}

            {/* Payment button — yazdırmadan bağımsız, ödeme al/kapat */}
            {activeOrder && (
              <button
                onClick={() => {
                  setPartialAmount((activeOrder.grandTotal - (activeOrder.paidAmount || 0)).toString());
                  setShowPaymentModal(true);
                }}
                className={styles.actionCircleBtn}
                title="Ödeme Al / Kapat"
              >
                <DollarSign size={20} />
              </button>
            )}

            {/* 3-dot menu */}
            <div ref={actionsMenuRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setIsActionsMenuOpen((v) => !v)}
                className={styles.actionCircleBtn}
                title="Masa İşlemleri"
              >
                <MoreVertical size={20} />
              </button>

              {isActionsMenuOpen && (
                <div className={styles.actionsDropdown}>
                  <button
                    className={styles.dropdownItem}
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      setIsTransferPinOpen(true);
                    }}
                  >
                    <ArrowRightLeft size={16} /> Masa Taşıma
                  </button>
                  <button
                    className={styles.dropdownItem}
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      setIsTableInfoOpen(true);
                    }}
                  >
                    <Info size={16} /> Masa Bilgileri
                  </button>
                  <button
                    className={styles.dropdownItem}
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      setIsTableNoteOpen(true);
                    }}
                  >
                    <StickyNote size={16} /> Masa Notu
                  </button>
                  {activeOrder && (
                    <button
                      className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`}
                      onClick={() => {
                        setIsActionsMenuOpen(false);
                        setIsCancelOrderModalOpen(true);
                      }}
                    >
                      <Trash2 size={16} /> {isCancellingOrder ? 'İptal ediliyor…' : 'Siparişi İptal Et'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={styles.leftContent}>
          {!activeOrderItems.length && !cart.length && (
            <div className={styles.emptyState}>
              <ShoppingBag size={64} strokeWidth={1} />
              <p style={{ fontWeight: 700, fontSize: '1.125rem' }}>Adisyon henüz boş.</p>
              <p style={{ fontSize: '0.875rem' }}>Yan taraftaki menüden ürün seçebilirsiniz.</p>
            </div>
          )}

          {activeOrderItems.length > 0 && (
            <div className={styles.section}>
              <span className={styles.sectionHeader}>Onaylanmış Ürünler</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {activeOrderItems.map((item: any) => {
                  const isCancelled = item.status === 'CANCELLED';
                  const isTreat = item.notes?.includes('[İKRAM]') || item.isTreat;
                  return (
                    <div key={item.id} className={styles.orderItem}>
                      <div className={styles.itemMain}>
                        <div className={styles.itemLabel}>
                          <span className={styles.itemQty}>{item.quantity}x</span>
                          <div>
                            <div
                              className={styles.itemName}
                              style={{ textDecoration: isCancelled ? 'line-through' : 'none' }}
                            >
                              {item.menuItemName}
                              {isCancelled && (
                                <span
                                  className="badge badge-danger"
                                  style={{ fontSize: '10px', padding: '2px 6px', marginLeft: 8 }}
                                >
                                  İptal
                                </span>
                              )}
                              {isTreat && !isCancelled && (
                                <span
                                  className="badge badge-warning"
                                  style={{ fontSize: '10px', padding: '2px 6px', marginLeft: 8 }}
                                >
                                  İkram
                                </span>
                              )}
                            </div>
                            {item.notes && !isTreat && (
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
                          </div>
                        </div>
                        <div className={styles.itemPrice}>
                          {isCancelled ? (
                            <span style={{ textDecoration: 'line-through', opacity: 0.5 }}>
                              ₺{item.totalPrice.toLocaleString('tr-TR')}
                            </span>
                          ) : isTreat ? (
                            <span style={{ color: 'var(--success)', fontWeight: 900 }}>İKRAM</span>
                          ) : (
                            `₺${item.totalPrice.toLocaleString('tr-TR')}`
                          )}
                        </div>
                      </div>
                      {!isCancelled && (
                        <div className={styles.itemActions}>
                          <button
                            onClick={() =>
                              handleUpdateItemStatus(item.id, item.status, '[İKRAM]')
                            }
                            disabled={pendingItemIds.has(item.id)}
                            className={styles.miniActionBtn}
                            style={{ color: 'var(--success)', opacity: pendingItemIds.has(item.id) ? 0.5 : 1 }}
                          >
                            İkram
                          </button>
                          <button
                            onClick={() => handleUpdateItemStatus(item.id, 'CANCELLED')}
                            disabled={pendingItemIds.has(item.id)}
                            className={styles.miniActionBtn}
                            style={{ color: 'var(--danger)', opacity: pendingItemIds.has(item.id) ? 0.5 : 1 }}
                          >
                            İptal
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {cart.length > 0 && (
            <div className={styles.section}>
              <span className={`${styles.sectionHeader} ${styles.sectionTitleWarning}`}>
                Bekleyen Ürünler
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
                        onClick={() => setItemToDelete(item.cartItemId)}
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
            </div>
          )}
        </div>

        <div className={styles.leftFooter}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {(activeOrder?.paidAmount || 0) > 0 ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Ara Toplam</span>
                  <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    ₺{pageTotal.toLocaleString('tr-TR')}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--success)' }}>Ödenen</span>
                  <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--success)' }}>
                    ₺{(activeOrder?.paidAmount || 0).toLocaleString('tr-TR')}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                  <span style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-secondary)' }}>Kalan Tutar</span>
                  <span style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--accent)', letterSpacing: '-0.02em' }}>
                    ₺{(pageTotal - (activeOrder?.paidAmount || 0)).toLocaleString('tr-TR')}
                  </span>
                </div>
              </>
            ) : (
              <div className={styles.totalRow}>
                <span className={styles.totalLabel}>Genel Toplam</span>
                <span className={styles.totalVal}>₺{pageTotal.toLocaleString('tr-TR')}</span>
              </div>
            )}
          </div>
          {cart.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button onClick={() => submitOrder(false)} disabled={isSubmitting} className={styles.submitBtn}>
                {isSubmitting ? (
                  <Loader2 className="animate-spin" size={24} />
                ) : (
                  <>
                    <Send size={24} /> MUTFAĞA GÖNDER VE YAZDIR
                  </>
                )}
              </button>
              <button 
                onClick={() => submitOrder(true)} 
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
                  onClick={() => addToCartFromMenu(item)}
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

      {/* ── PRINT OPTIONS MODAL ────────────────────────────────── */}
      {isPrintModalOpen && (
        <div className="modal-backdrop" onClick={() => !isPrinting && setIsPrintModalOpen(false)}>
          <div
            className="modal-content"
            style={{ width: '100%', maxWidth: 380, padding: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 24,
              }}
            >
              <h3 style={{ fontSize: '1.25rem', fontWeight: 900 }}>Yazdırma Seçenekleri</h3>
              <button
                onClick={() => !isPrinting && setIsPrintModalOpen(false)}
                style={{
                  background: 'var(--bg-elevated)',
                  border: 'none',
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                onClick={handlePrintStations}
                disabled={!!isPrinting}
                style={{
                  padding: '18px 20px',
                  borderRadius: 'var(--radius-xl)',
                  border: 'none',
                  background:
                    isPrinting === 'stations'
                      ? '#4338ca'
                      : 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: isPrinting ? 'not-allowed' : 'pointer',
                  opacity: isPrinting && isPrinting !== 'stations' ? 0.5 : 1,
                  boxShadow: '0 4px 14px rgba(79,70,229,0.3)',
                  transition: 'all 0.2s',
                }}
              >
                {isPrinting === 'stations' ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <UtensilsCrossed size={20} />
                )}
                <div style={{ textAlign: 'left' }}>
                  <div>Mutfağa Otomatik Dağıt</div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.8, fontWeight: 600 }}>
                    Izgara / Fırın yazıcılarına otomatik
                  </div>
                </div>
              </button>

              <button
                onClick={handlePrintBill}
                disabled={!!isPrinting}
                style={{
                  padding: '18px 20px',
                  borderRadius: 'var(--radius-xl)',
                  border: '2px solid var(--border)',
                  background: isPrinting === 'bill' ? 'var(--bg-muted)' : 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  fontWeight: 800,
                  fontSize: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: isPrinting ? 'not-allowed' : 'pointer',
                  opacity: isPrinting && isPrinting !== 'bill' ? 0.5 : 1,
                  transition: 'all 0.2s',
                }}
              >
                {isPrinting === 'bill' ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Receipt size={20} />
                )}
                <div style={{ textAlign: 'left' }}>
                  <div>Adisyona Yazdır</div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      opacity: 0.6,
                      fontWeight: 600,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Kasa yazıcısına adisyon gönder
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TABLE NOTE MODAL ───────────────────────────────────── */}
      {isTableNoteOpen && (
        <div className="modal-backdrop" onClick={() => setIsTableNoteOpen(false)}>
          <div
            className="modal-content"
            style={{ width: '100%', maxWidth: 400, padding: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 20,
              }}
            >
              <h3 style={{ fontSize: '1.25rem', fontWeight: 900 }}>Masa Notu</h3>
              <button
                onClick={() => setIsTableNoteOpen(false)}
                style={{
                  background: 'var(--bg-elevated)',
                  border: 'none',
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <X size={18} />
              </button>
            </div>
            <textarea
              value={tableNote}
              onChange={(e) => setTableNote(e.target.value)}
              placeholder="Masa için not giriniz... (ör: pencere kenarı, özel istek)"
              style={{
                width: '100%',
                height: 140,
                padding: 16,
                borderRadius: 'var(--radius-lg)',
                border: '1.5px solid var(--border-strong)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: '0.9375rem',
                resize: 'none',
                outline: 'none',
                fontFamily: 'var(--font-primary)',
                marginBottom: 16,
              }}
            />
            <button
              onClick={handleSaveNote}
              disabled={isSavingNote}
              style={{
                width: '100%',
                height: 52,
                borderRadius: 'var(--radius-xl)',
                background: 'var(--gradient-accent)',
                color: '#fff',
                border: 'none',
                fontWeight: 800,
                fontSize: '1rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              {isSavingNote ? <Loader2 size={18} className="animate-spin" /> : 'Kaydet'}
            </button>
          </div>
        </div>
      )}

      {/* ── TABLE INFO MODAL ───────────────────────────────────── */}
      {isTableInfoOpen && tableInfo && (
        <div className="modal-backdrop" onClick={() => setIsTableInfoOpen(false)}>
          <div
            className="modal-content"
            style={{ width: '100%', maxWidth: 380, padding: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 24,
              }}
            >
              <h3 style={{ fontSize: '1.25rem', fontWeight: 900 }}>Masa Bilgileri</h3>
              <button
                onClick={() => setIsTableInfoOpen(false)}
                style={{
                  background: 'var(--bg-elevated)',
                  border: 'none',
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                { label: 'Masa No', value: tableInfo.number },
                { label: 'Bölge / Zone', value: tableInfo.zone || '—' },
                { label: 'Kapasite', value: tableInfo.capacity ? `${tableInfo.capacity} kişi` : '—' },
                { label: 'Durum', value: tableInfo.status === 'AVAILABLE' ? '🟢 Boş' : '🔴 Dolu' },
                { label: 'Sipariş No', value: activeOrder ? `#${activeOrder.orderNumber}` : '—' },
                {
                  label: 'Toplam Tutar',
                  value: activeOrder ? `₺${activeOrder.grandTotal.toLocaleString('tr-TR')}` : '—',
                },
                { label: 'Masa Notu', value: tableInfo.note || '—' },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    paddingBottom: 12,
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', fontWeight: 600 }}>
                    {label}
                  </span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <OrderItemModal
        isOpen={isItemConfigModalOpen}
        onClose={() => setIsItemConfigModalOpen(false)}
        menuItem={selectedMenuItem}
        onAdd={handleAddToCartConfirm}
      />
      <TableTransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        activeOrder={activeOrder}
        currentTableId={tableId}
      />
      <PinPadModal
        isOpen={isTransferPinOpen}
        onClose={() => setIsTransferPinOpen(false)}
        onSuccess={() => {
          setIsTransferPinOpen(false);
          setIsTransferModalOpen(true);
        }}
        title="Taşıma Yetkisi"
        description="Garson PIN'inizi giriniz."
        requiredRole={['OWNER', 'CHEF', 'WAITER']}
      />

      <ConfirmModal
        isOpen={!!itemToDelete}
        onClose={() => setItemToDelete(null)}
        onConfirm={() => {
          if (itemToDelete) handleRemoveFromCart(itemToDelete);
        }}
        title="Ürünü Sil"
        description="Bu ürünü sepetten silmek istediğinize emin misiniz?"
        confirmText="Evet, Sil"
        cancelText="Vazgeç"
        type="danger"
      />

      <ConfirmModal
        isOpen={isCancelOrderModalOpen}
        onClose={() => setIsCancelOrderModalOpen(false)}
        onConfirm={() => {
          setIsCancelOrderModalOpen(false);
          handleCancelOrder();
        }}
        title="Siparişi İptal Et"
        description="Tüm siparişi iptal etmek istediğinize emin misiniz? Bu işlem geri alınamaz."
        confirmText="Evet, İptal Et"
        cancelText="Vazgeç"
        type="danger"
      />

      {/* ── PAYMENT MODAL ── */}
      {showPaymentModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(8px)' }}>
          <div style={{ width: '100%', maxWidth: 440, background: 'var(--bg-surface)', borderRadius: 'var(--radius-2xl)', padding: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 900 }}>Ödeme Al</h3>
              <button onClick={() => { setShowPaymentModal(false); setIsWaitingForPOS(false); }} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}><X size={24} /></button>
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
                    style={{ marginTop: 20, background: 'none', border: 'none', color: 'var(--accent-danger)', fontWeight: 700, cursor: 'pointer' }}
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
                        style={{ minHeight: 104, padding: '12px 8px', borderRadius: 'var(--radius-xl)', border: '2px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9, fontWeight: 800, fontSize: '0.78rem', cursor: 'pointer', color: 'var(--text-primary)' }}
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
  );
}
