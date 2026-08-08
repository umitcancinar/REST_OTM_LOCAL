// ==========================================
// Odeme Yontemleri — TEK KAYNAK
// ==========================================
// Bu liste hem masa siparis ekraninda hem ActiveOrderDrawer'da kullanilir.
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

/** Listelerde/detaylarda gosterilen kisa adlar. */
export const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Nakit',
  CARD: 'Kredi Kartı',
  IBAN: 'IBAN / Havale',
  YEMEK_SEPETI: 'Yemek Sepeti',
  TRENDYOL_GO: 'Trendyol Go',
  GETIR: 'Getir',
};

export const PAYMENT_METHOD_OPTIONS: PaymentMethodOption[] = [
  { key: 'CASH', label: 'NAKİT', color: '#15803D', bg: '#DCFCE7', icon: Banknote },
  { key: 'CARD', label: 'KREDİ KARTI', color: '#1D4ED8', bg: '#DBEAFE', icon: CreditCard },
  { key: 'IBAN', label: 'IBAN / HAVALE', color: '#0284C7', bg: '#E0F2FE', icon: Landmark },
  { key: 'YEMEK_SEPETI', label: 'YEMEK SEPETİ', color: '#EA004B', bg: '#FCE7EE', icon: ShoppingBag },
  { key: 'TRENDYOL_GO', label: 'TRENDYOL GO', color: '#F27A1A', bg: '#FEF0E3', icon: ShoppingBag },
  { key: 'GETIR', label: 'GETİR', color: '#5D3EBC', bg: '#EDE7FB', icon: ShoppingBag },
];
