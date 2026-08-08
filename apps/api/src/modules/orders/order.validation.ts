import { z } from 'zod';
import { orderIdempotencyKeySchema } from './order-idempotency.policy';

export const orderItemSchema = z.object({
  menuItemId: z.string().min(1, 'Menu item ID is required'),
  quantity: z.number().positive('Quantity must be greater than 0'),
  portionOption: z.string().optional(),
  portionMultiplier: z.number().positive().optional(),
  extras: z.array(z.object({
    name: z.string(),
    price: z.number().min(0)
  })).optional(),
  notes: z.string().optional(),
});

export const subCheckSchema = z.object({
  label: z.string().min(1, 'Sub-check label is required'),
  items: z.array(orderItemSchema).min(1, 'At least one item is required'),
});

export const createOrderSchema = z.object({
  clientCommandId: orderIdempotencyKeySchema.optional(),
  type: z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']).default('DINE_IN'),
  printToKitchen: z.boolean().optional().default(false),
  tableId: z.string().optional(),
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  customerAddress: z.string().optional(),
  notes: z.string().optional(),
  subChecks: z.array(subCheckSchema).min(1, 'At least one sub-check is required'),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(['PENDING', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED']),
  paymentMethod: z.enum(['CASH', 'CARD', 'IBAN', 'YEMEK_SEPETI', 'TRENDYOL_GO', 'GETIR']).optional(),
  amount: z.number().optional(),
});

export const updateItemStatusSchema = z.object({
  status: z.enum(['PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED']),
  notes: z.string().optional(),
});

export const transferTableSchema = z.object({
  newTableId: z.string().min(1, 'New table ID is required'),
});

export const updateItemQuantitySchema = z.object({
  quantity: z.number().positive('Quantity must be greater than 0'),
});
