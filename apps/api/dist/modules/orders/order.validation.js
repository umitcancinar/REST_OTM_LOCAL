"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateItemQuantitySchema = exports.transferTableSchema = exports.updateItemStatusSchema = exports.updateOrderStatusSchema = exports.createOrderSchema = exports.subCheckSchema = exports.orderItemSchema = void 0;
const zod_1 = require("zod");
exports.orderItemSchema = zod_1.z.object({
    menuItemId: zod_1.z.string().min(1, 'Menu item ID is required'),
    quantity: zod_1.z.number().positive('Quantity must be greater than 0'),
    portionOption: zod_1.z.string().optional(),
    portionMultiplier: zod_1.z.number().positive().optional(),
    extras: zod_1.z.array(zod_1.z.object({
        name: zod_1.z.string(),
        price: zod_1.z.number().min(0)
    })).optional(),
    notes: zod_1.z.string().optional(),
});
exports.subCheckSchema = zod_1.z.object({
    label: zod_1.z.string().min(1, 'Sub-check label is required'),
    items: zod_1.z.array(exports.orderItemSchema).min(1, 'At least one item is required'),
});
exports.createOrderSchema = zod_1.z.object({
    type: zod_1.z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']).default('DINE_IN'),
    printToKitchen: zod_1.z.boolean().optional().default(false),
    tableId: zod_1.z.string().optional(),
    customerId: zod_1.z.string().optional(),
    customerName: zod_1.z.string().optional(),
    customerPhone: zod_1.z.string().optional(),
    customerAddress: zod_1.z.string().optional(),
    notes: zod_1.z.string().optional(),
    subChecks: zod_1.z.array(exports.subCheckSchema).min(1, 'At least one sub-check is required'),
});
exports.updateOrderStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(['PENDING', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED']),
    paymentMethod: zod_1.z.enum(['CASH', 'CARD', 'IBAN', 'YEMEK_SEPETI', 'TRENDYOL_GO', 'GETIR']).optional(),
    amount: zod_1.z.number().optional(),
});
exports.updateItemStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(['PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED']),
    notes: zod_1.z.string().optional(),
});
exports.transferTableSchema = zod_1.z.object({
    newTableId: zod_1.z.string().min(1, 'New table ID is required'),
});
exports.updateItemQuantitySchema = zod_1.z.object({
    quantity: zod_1.z.number().positive('Quantity must be greater than 0'),
});
//# sourceMappingURL=order.validation.js.map