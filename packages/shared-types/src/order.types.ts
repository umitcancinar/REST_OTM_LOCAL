// ==========================================
// Order Types
// ==========================================

export enum OrderStatus {
  UNPAID = 'UNPAID',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

export enum OrderItemStatus {
  PENDING = 'PENDING',
  PREPARING = 'PREPARING',
  READY = 'READY',
  SERVED = 'SERVED',
  CANCELLED = 'CANCELLED',
}

export enum PaymentMethod {
  CASH = 'CASH',
  CREDIT_CARD = 'CREDIT_CARD',
  SPLIT = 'SPLIT',
}

export interface Order {
  id: string;
  tenantId: string;
  tableId: string;
  waiterId: string;
  orderNumber: string;
  status: OrderStatus;
  subChecks: SubCheck[];
  totalAmount: number;
  taxAmount: number;
  serviceCharge: number;
  discountAmount: number;
  grandTotal: number;
  paymentMethod?: PaymentMethod;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

/** Alt adisyon — Alman usulü hesap bölme */
export interface SubCheck {
  id: string;
  orderId: string;
  label: string; // e.g. "Kişi 1", "Bay Ahmet"
  items: OrderItem[];
  subtotal: number;
  isPaid: boolean;
  paymentMethod?: PaymentMethod;
}

export interface OrderItem {
  id: string;
  subCheckId: string;
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  portionOption: string; // e.g. "Normal", "1.5", "Duble"
  portionMultiplier: number;
  unitPrice: number;
  extras: OrderItemExtra[];
  totalPrice: number;
  notes?: string; // e.g. "Az pişmiş", "Soğansız"
  status: OrderItemStatus;
  department: string;
  createdAt: Date;
}

export interface OrderItemExtra {
  name: string;
  price: number;
}

export interface CreateOrderDTO {
  tableId: string;
  subChecks: CreateSubCheckDTO[];
  notes?: string;
}

export interface CreateSubCheckDTO {
  label: string;
  items: CreateOrderItemDTO[];
}

export interface CreateOrderItemDTO {
  menuItemId: string;
  quantity: number;
  portionOption?: string;
  portionMultiplier?: number;
  extras?: OrderItemExtra[];
  notes?: string;
}

/** Offline sipariş kuyruğunda tutulacak yapı */
export interface OfflineOrderPayload {
  localId: string; // UUID generated on device
  payload: CreateOrderDTO;
  timestamp: number;
  synced: boolean;
}
