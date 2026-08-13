export interface ReceiptOrderItem {
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes?: string | null;
}

/**
 * Print agents multiply `quantity * price` while rendering a bill line.
 * Therefore `price` must always be the effective per-unit price, never the
 * whole-line OrderItem.totalPrice. Dividing the persisted line total also
 * preserves portion multipliers and paid extras.
 */
export function toReceiptLine(item: ReceiptOrderItem) {
  return {
    name: item.menuItemName,
    quantity: item.quantity,
    price: item.quantity > 0 ? item.totalPrice / item.quantity : item.unitPrice,
    notes: item.notes || undefined,
  };
}
