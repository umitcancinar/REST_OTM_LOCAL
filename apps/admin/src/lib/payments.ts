// ==========================================
// Odeme Yontemleri — TEK KAYNAK
// ==========================================
// Siparisler, masa siparis ekrani ve raporlar bu listeyi kullanir.
// Anahtarlar API'nin kabul ettigi enum ile BIREBIR eslesmek zorundadir:
// apps/api/src/modules/orders/order.validation.ts -> updateOrderStatusSchema
// Yeni bir yontem eklenecekse once orayi, sonra burayi guncelle.

import { Banknote, CreditCard, Landmark, ShoppingBag } from 'lucide-react';

export type PaymentMethod = 'CASH' | 'CARD' | 'IBAN' | 'YEMEK_SEPETI' | 'TRENDYOL_GO' | 'GETIR';

export interface PaymentMethodOption {
  key: PaymentMethod;
  label: string;
  /** Ikon rengi */
  color: string;
  /** Ikon arkasindaki yumusak zemin */
  bg: string;
  icon: typeof Banknote;
}

export const PAYMENT_METHOD_OPTIONS: PaymentMethodOption[] = [
  { key: 'CASH', label: 'NAKİT', color: '#15803D', bg: '#DCFCE7', icon: Banknote },
  { key: 'CARD', label: 'KREDİ KARTI', color: '#1D4ED8', bg: '#DBEAFE', icon: CreditCard },
  { key: 'IBAN', label: 'IBAN / HAVALE', color: '#0284C7', bg: '#E0F2FE', icon: Landmark },
  { key: 'YEMEK_SEPETI', label: 'YEMEK SEPETİ', color: '#EA004B', bg: '#FCE7EE', icon: ShoppingBag },
  { key: 'TRENDYOL_GO', label: 'TRENDYOL GO', color: '#F27A1A', bg: '#FEF0E3', icon: ShoppingBag },
  { key: 'GETIR', label: 'GETİR', color: '#5D3EBC', bg: '#EDE7FB', icon: ShoppingBag },
];

/** Raporlarda/listelerde kullanilan kisa, okunakli adlar. */
export const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Nakit',
  CARD: 'Kredi Kartı',
  IBAN: 'IBAN / Havale',
  YEMEK_SEPETI: 'Yemek Sepeti',
  TRENDYOL_GO: 'Trendyol Go',
  GETIR: 'Getir',
};

/**
 * Bir siparisin odemesi birden fazla yontemle yapilmis olabilir
 * (orn. 500 TL nakit + 1000 TL kart). `order.payments` bu kismi odemelerin
 * her birini kendi yontemi/tutariyla tutar; `order.paymentMethod` ise
 * yalnizca SON kullanilan yontemi tutar. Izlenmeyen bir kalan varsa
 * (eski/basit tamamlama akisindan geldigi icin) o kalan paymentMethod'a
 * atanir; boylece kirilim her zaman grandTotal'a esitlenir.
 */
export function paymentBreakdown(order: any): { label: string; isMixed: boolean } {
  const tracked: Array<{ method?: string; amount?: number }> = Array.isArray(order?.payments) ? order.payments : [];
  const byMethod: Record<string, number> = {};
  let trackedSum = 0;

  for (const payment of tracked) {
    const method = payment.method || 'CASH';
    const amount = Number(payment.amount) || 0;
    byMethod[method] = (byMethod[method] || 0) + amount;
    trackedSum += amount;
  }

  const remainder = Number(order?.grandTotal || 0) - trackedSum;
  if (remainder > 0.01) {
    const method = order?.paymentMethod || 'CASH';
    byMethod[method] = (byMethod[method] || 0) + remainder;
  }

  const methods = Object.keys(byMethod);
  if (methods.length <= 1) {
    const method = methods[0] || order?.paymentMethod;
    return { label: PAYMENT_LABELS[method] || 'Nakit', isMixed: false };
  }

  const label = methods
    .map(m => `₺${byMethod[m]!.toLocaleString('tr-TR')} ${PAYMENT_LABELS[m] || m}`)
    .join(' + ');
  return { label, isMixed: true };
}
