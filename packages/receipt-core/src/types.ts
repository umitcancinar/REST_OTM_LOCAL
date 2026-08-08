// ==========================================
// REST_OTM · Fiş Render Çekirdeği — Tipler
// ==========================================
// Bu paket, admin panelindeki ÖNİZLEME ile yazıcıdan çıkan FİZİKSEL FİŞ'in
// birebir aynı olmasını garanti eder. Her iki taraf da aynı `ReceiptDoc`
// nesnesini kullanır: önizleme onu HTML'e, print-agent ESC/POS'a çevirir.

export type Align = 'left' | 'center' | 'right';
/** Karakter hücresi çarpanı. 1 = normal, 2 = 2x, 3 = 3x, 4 = 4x */
export type Scale = 1 | 2 | 3 | 4;
export type PaperWidth = 58 | 80;
export type PrintLayoutKey = 'KITCHEN' | 'GRILL' | 'CASHIER' | 'PAKET';

/**
 * Render motoru sürümü. Print-agent açılışta bunu basar; sahada "güncelledim
 * ama değişmedi" durumunda agent'ın gerçekten yeni kodu çalıştırıp
 * çalıştırmadığı tahminle değil, konsoldan bakılarak anlaşılır.
 * Çıktının fiziksel ölçüsünü etkileyen her değişiklikte artırılmalı.
 */
export const RENDER_ENGINE_VERSION = 2;

/** 203 DPI termal yazıcı: 1 mm ≈ 8 nokta */
export const DOTS_PER_MM = 203 / 25.4;
/** ESC/POS varsayılan satır yüksekliği (nokta). Önizleme ile ortak. */
export const LINE_HEIGHT_DOTS = 24;

export const PAPER_COLUMNS: Record<PaperWidth, number> = { 58: 32, 80: 48 };
export const PAPER_PIXELS: Record<PaperWidth, number> = { 58: 384, 80: 576 };
/** Basilabilir alan (mm): 58 mm kagitta ~48 mm, 80 mm kagitta ~72 mm. Onizleme ile ortak. */
export const PRINTABLE_MM: Record<PaperWidth, number> = { 58: 48, 80: 72 };

/** Fişteki tek tek ayarlanabilen öğeler. */
export type ElementKey =
  | 'logo'
  | 'header'
  | 'subHeader'
  | 'title'
  | 'customer'
  | 'orderNote'
  | 'dateTime'
  | 'table'
  | 'orderNo'
  | 'waiter'
  | 'columnsHeader'
  | 'item'
  | 'itemNote'
  | 'total'
  | 'paymentMethod'
  | 'payments'
  | 'remaining'
  | 'paidItems'
  | 'cancelTitle'
  | 'treatTitle'
  | 'footer';

export const ELEMENT_KEYS: ElementKey[] = [
  'logo', 'header', 'subHeader', 'title', 'customer', 'orderNote',
  'dateTime', 'table', 'orderNo', 'waiter', 'columnsHeader', 'item',
  'itemNote', 'total', 'paymentMethod', 'payments', 'remaining',
  'paidItems', 'cancelTitle', 'treatTitle', 'footer',
];

/** Kullanıcıya gösterilen Türkçe öğe adları (admin UI için). */
export const ELEMENT_LABELS: Record<ElementKey, string> = {
  logo: 'Logo',
  header: 'İşletme Adı (Başlık)',
  subHeader: 'Alt Başlık',
  title: 'Fiş Başlığı (ADİSYON / FIRIN FİŞİ / İPTAL …)',
  customer: 'Müşteri Bilgileri (Paket)',
  orderNote: 'Sipariş Notu',
  dateTime: 'Tarih & Saat',
  table: 'Masa No / PAKET Yazısı',
  orderNo: 'Fiş No',
  waiter: 'Garson',
  columnsHeader: 'Sütun Başlıkları (ÜRÜN / ADET / TUTAR)',
  item: 'Ürün Satırları',
  itemNote: 'Ürün Notu',
  total: 'TOPLAM',
  paymentMethod: 'Ödeme Tipi (NAKİT / KART …)',
  payments: 'Tahsilat Satırları',
  remaining: 'KALAN',
  paidItems: 'Ödenen Ürünler (altta liste)',
  cancelTitle: 'İPTAL FİŞİ Yazısı',
  treatTitle: 'İKRAM FİŞİ Yazısı',
  footer: 'Alt Bilgi (Footer)',
};

export interface ElementStyle {
  visible: boolean;
  bold: boolean;
  align: Align;
  scale: Scale;
  /** Öğeye ait metin/etiket override'ı (boş = varsayılan). */
  text?: string;
}

export interface ReceiptLabels {
  cancelTitle: string;
  treatTitle: string;
  takeaway: string;
  tableInline: string;
  tableBlock: string;
  dateBlock: string;
  timeBlock: string;
  orderNo: string;
  waiter: string;
  colProduct: string;
  colQty: string;
  colAmount: string;
  total: string;
  remaining: string;
  payments: string;
  paidItems: string;
  note: string;
  treatTag: string;
  customer: string;
  phone: string;
  address: string;
  orderNote: string;
  currency: string;
}

export interface ReceiptLayout {
  paperWidth: PaperWidth;
  /** Kağıdın üstünde bırakılacak boşluk (mm). Önizlemede sürüklenebilir. */
  topMarginMm: number;
  /** Son satırdan kesime kadar bırakılacak boşluk (mm). Önizlemede sürüklenebilir. */
  bottomMarginMm: number;
  /** Cihazın mekanik üst payı (mm). Yazıcı kafası farkını telafi eder. */
  deviceTopTrimMm: number;
  /** Sol ve sağ kenarda simetrik olarak bırakılacak boşluk (mm). */
  sideMarginMm: number;

  logoUrl: string;
  logoWidth: number;
  logoPosition: Align;

  headerText: string;
  subHeaderText: string;
  receiptTitle: string;
  footerText: string;

  separatorChar: string;
  itemSeparatorChar: string;
  showItemSeparator: boolean;
  /** Ürün satırındaki ADET sütunu genişliği (karakter). */
  qtyWidth: number;
  /** Ürün satırındaki TUTAR sütunu genişliği (karakter). */
  priceWidth: number;
  /** Tarih/saat ile masa numarasını yan yana yaz. */
  inlineDateMasa: boolean;
  /** Fiyat sütunlarını tamamen gizle (mutfak fişi). */
  hidePrices: boolean;
  /** Ödenen ürünleri fişin altına listele. */
  showPaidItems: boolean;

  elements: Record<ElementKey, ElementStyle>;
  labels: ReceiptLabels;
}

/** Render edilmiş tek bir fiş satırı. Metin zaten sarılmış ve hizalanmıştır. */
export interface DocLine {
  /** Yazdırılacak ham metin (sarma/kırpma uygulanmış). */
  text: string;
  align: Align;
  bold: boolean;
  scale: Scale;
  /** Bu satırın hangi öğeden geldiği — önizlemede vurgulamak için. */
  source: ElementKey | 'separator' | 'spacer';
}

export interface DocLogo {
  url: string;
  widthMm: number;
  align: Align;
}

export interface ReceiptDoc {
  columns: number;
  paperWidth: PaperWidth;
  /** Efektif üst boşluk (deviceTopTrimMm düşülmüş hali) — hem önizleme hem yazıcı bunu kullanır. */
  topMarginMm: number;
  bottomMarginMm: number;
  logo?: DocLogo;
  lines: DocLine[];
  /** İptal fişinde uzun uyarı sesi çal. */
  strongBeep: boolean;
}

export interface ReceiptItemInput {
  name: string;
  quantity: number;
  price?: number | null;
  portionOption?: string | null;
  notes?: string | null;
  isTreat?: boolean;
  isPaid?: boolean;
}

export interface ReceiptPaymentInput {
  method: string;
  amount: number;
}

export interface ReceiptInput {
  kind: 'STATION' | 'BILL';
  layout: ReceiptLayout;
  orderNumber: string;
  tableNumber: number;
  waiterName?: string | null;
  timestamp: Date;
  items: ReceiptItemInput[];
  total?: number;
  payments?: ReceiptPaymentInput[];
  paymentMethod?: string | null;
  customer?: { name: string; phone?: string | null; address?: string | null } | null;
  notes?: string | null;
  isCancel?: boolean;
  isTreat?: boolean;
}
