// ==========================================
// Order Service — Core Business Logic
// ==========================================

import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { resolvePreparationDepartment } from '../../utils/department-routing';
import { resolveItemPrintTrigger } from '../../utils/print-triggers';
import { printService } from '../printing/print.service';
import {
  hashOrderCommand,
  IdempotencyConflictError,
} from './order-idempotency.policy';
import {
  allocateOrderNumber,
} from './order-number.policy';

const createdOrderInclude = {
  table: { select: { number: true, zone: true } },
  customer: true,
  waiter: { select: { name: true } },
  subChecks: { include: { items: true } },
} as const;

export interface CreateOrderInput {
  type?: string;
  printToKitchen?: boolean;
  tableId?: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  notes?: string;
  subChecks: Array<{
    label: string;
    items: Array<{
      menuItemId: string;
      quantity: number;
      portionOption?: string;
      portionMultiplier?: number;
      extras?: Array<{ name: string; price: number }>;
      notes?: string;
    }>;
  }>;
}

export interface CreateOrderOptions {
  idempotencyKey?: string;
}

export interface CreateOrderResult {
  order: any;
  isReplay: boolean;
}

/**
 * Allocate inside the order transaction. PostgreSQL serializes the upsert on
 * the tenant/day primary key, so distinct concurrent commands receive distinct
 * monotonically increasing values. A rollback also rolls back the increment.
 */
async function generateOrderNumber(
  tenantId: string,
  client: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<string> {
  return allocateOrderNumber(tenantId, async (counterTenantId, businessDate) => {
    const rows = await client.$queryRaw<Array<{ value: number }>>(Prisma.sql`
      INSERT INTO "order_counters" ("tenantId", "businessDate", "value", "updatedAt")
      VALUES (${counterTenantId}, CAST(${businessDate} AS DATE), 1, CURRENT_TIMESTAMP)
      ON CONFLICT ("tenantId", "businessDate")
      DO UPDATE SET
        "value" = "order_counters"."value" + 1,
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "value"
    `);
    const sequence = rows[0]?.value;
    if (sequence === undefined) throw new Error('Order counter did not return a value');
    return sequence;
  }, now);
}

async function loadIdempotentReplay(
  tenantId: string,
  idempotencyKey: string,
  payloadHash: string,
): Promise<CreateOrderResult | null> {
  const command = await prisma.orderCommand.findUnique({
    where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
    include: { order: { include: createdOrderInclude } },
  });

  if (!command) return null;
  if (command.payloadHash !== payloadHash) throw new IdempotencyConflictError();
  if (!command.order) {
    // A receipt and its result are committed atomically. Reaching this branch
    // indicates manual database corruption rather than an in-flight request.
    throw Object.assign(new Error('Idempotency receipt has no order result'), {
      statusCode: 503,
      code: 'IDEMPOTENCY_RESULT_UNAVAILABLE',
    });
  }

  return {
    order: { ...command.order, newItemIds: command.createdItemIds },
    isReplay: true,
  };
}

export const orderService = {
  async syncTableStatus(tenantId: string, tableId: string, tx?: any) {
    const client = tx || prisma;
    const activeOrdersCount = await client.order.count({
      where: {
        tenantId,
        tableId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        isDeleted: false,
      },
    });

    await client.restaurantTable.update({
      where: { id: tableId, tenantId },
      data: { status: activeOrdersCount > 0 ? 'OCCUPIED' : 'AVAILABLE' },
    });
  },

  async findAll(tenantId: string, filters?: { status?: string; tableId?: string; waiterId?: string; type?: string; isDeleted?: boolean; date?: string }) {
    const where: any = { tenantId, isDeleted: filters?.isDeleted ?? false };
    if (filters?.status) where.status = filters.status;
    if (filters?.type) where.type = filters.type;
    if (filters?.tableId) where.tableId = filters.tableId;
    if (filters?.waiterId) where.waiterId = filters.waiterId;
    if (filters?.date) {
      const date = new Date(filters.date);
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      where.createdAt = { gte: date, lt: nextDay };
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        table: { select: { number: true, zone: true } },
        customer: true,
        waiter: { select: { name: true } },
        subChecks: {
          include: { items: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Normalize: old completed orders with null paymentMethod default to CASH
    return orders.map((o: any) => ({
      ...o,
      paymentMethod: o.paymentMethod ?? (o.status === 'COMPLETED' ? 'CASH' : null),
    }));
  },

  async findById(tenantId: string, id: string) {
    const order = await prisma.order.findFirst({
      where: { id, tenantId },
      include: {
        table: true,
        customer: true,
        waiter: { select: { id: true, name: true } },
        subChecks: { include: { items: true } },
      },
    });
    if (!order) return null;
    return {
      ...order,
      paymentMethod: order.paymentMethod ?? (order.status === 'COMPLETED' ? 'CASH' : null),
    };
  },

  async create(
    tenantId: string,
    waiterId: string | null,
    data: CreateOrderInput,
    options: CreateOrderOptions = {},
  ): Promise<CreateOrderResult> {
    const idempotencyKey = options.idempotencyKey;
    const payloadHash = idempotencyKey ? hashOrderCommand(data) : undefined;

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Insert first. PostgreSQL holds the unique-index conflict until this
        // transaction commits, so concurrent retries cannot both mutate an order.
        if (idempotencyKey && payloadHash) {
          await tx.orderCommand.create({
            data: { tenantId, idempotencyKey, payloadHash },
          });
        }

        let finalCustomerId = data.customerId;
        if (!finalCustomerId && data.customerName) {
          const existingCustomer = await tx.customer.findFirst({
            where: {
              tenantId,
              phone: data.customerPhone || undefined,
              name: { equals: data.customerName, mode: 'insensitive' },
            },
          });

          if (existingCustomer) {
            finalCustomerId = existingCustomer.id;
          } else {
            const newCustomer = await tx.customer.create({
              data: {
                tenantId,
                name: data.customerName,
                phone: data.customerPhone || '',
                address: data.customerAddress || '',
              },
            });
            finalCustomerId = newCustomer.id;
          }
        }

        const menuItemIds = data.subChecks.flatMap((sc) =>
          sc.items.map((item) => item.menuItemId),
        );
        const menuItems = await tx.menuItem.findMany({
          where: { id: { in: menuItemIds }, tenantId },
          include: { category: { select: { name: true } } },
        });
        const menuItemMap = new Map(menuItems.map((menuItem) => [menuItem.id, menuItem]));

        const existingOrder = data.tableId && data.type !== 'TAKEAWAY'
          ? await tx.order.findFirst({
              where: {
                tenantId,
                tableId: data.tableId,
                isDeleted: false,
                status: { notIn: ['COMPLETED', 'CANCELLED'] },
              },
            })
          : null;

        let persistedOrder: any;
        let newItemIds: string[] = [];

        if (existingOrder) {
          let totalAddedAmount = 0;
          for (const subCheck of data.subChecks) {
            let subCheckTotal = 0;
            const items = subCheck.items.map((item) => {
              const menuItem = menuItemMap.get(item.menuItemId);
              if (!menuItem) throw Object.assign(new Error(`Menu item ${item.menuItemId} not found`), { statusCode: 404 });

              const multiplier = item.portionMultiplier || 1;
              const extrasTotal = (item.extras || []).reduce((sum, extra) => sum + extra.price, 0);
              const itemTotal = (menuItem.basePrice * multiplier + extrasTotal) * item.quantity;
              subCheckTotal += itemTotal;
              return {
                menuItemId: item.menuItemId,
                menuItemName: menuItem.name,
                quantity: item.quantity,
                portionOption: item.portionOption || 'Normal',
                portionMultiplier: multiplier,
                unitPrice: menuItem.basePrice,
                extras: item.extras || [],
                totalPrice: itemTotal,
                notes: item.notes,
                department: resolvePreparationDepartment(menuItem.department, menuItem.category.name),
                status: 'PENDING' as const,
              };
            });

            totalAddedAmount += subCheckTotal;
            const createdSubCheck = await tx.subCheck.create({
              data: {
                orderId: existingOrder.id,
                label: subCheck.label,
                subtotal: subCheckTotal,
                items: { create: items },
              },
              include: { items: { select: { id: true } } },
            });
            newItemIds.push(...createdSubCheck.items.map((item) => item.id));
          }

          persistedOrder = await tx.order.update({
            where: { id: existingOrder.id },
            data: {
              totalAmount: { increment: totalAddedAmount },
              grandTotal: { increment: totalAddedAmount },
            },
            include: createdOrderInclude,
          });
          logger.info(`Appended items to existing order: ${existingOrder.orderNumber}`);
        } else {
          const orderNumber = await generateOrderNumber(tenantId, tx);
          let totalAmount = 0;
          persistedOrder = await tx.order.create({
            data: {
              tenantId,
              type: data.type || 'DINE_IN',
              tableId: data.tableId,
              customerId: finalCustomerId,
              waiterId,
              orderNumber,
              notes: data.notes,
              status: 'PENDING',
              subChecks: {
                create: data.subChecks.map((subCheck) => {
                  let subCheckTotal = 0;
                  const items = subCheck.items.map((item) => {
                    const menuItem = menuItemMap.get(item.menuItemId);
                    if (!menuItem) throw Object.assign(new Error(`Menu item ${item.menuItemId} not found`), { statusCode: 404 });

                    const multiplier = item.portionMultiplier || 1;
                    const extrasTotal = (item.extras || []).reduce((sum, extra) => sum + extra.price, 0);
                    const itemTotal = (menuItem.basePrice * multiplier + extrasTotal) * item.quantity;
                    subCheckTotal += itemTotal;
                    return {
                      menuItemId: item.menuItemId,
                      menuItemName: menuItem.name,
                      quantity: item.quantity,
                      portionOption: item.portionOption || 'Normal',
                      portionMultiplier: multiplier,
                      unitPrice: menuItem.basePrice,
                      extras: item.extras || [],
                      totalPrice: itemTotal,
                      notes: item.notes,
                      department: resolvePreparationDepartment(menuItem.department, menuItem.category.name),
                      status: 'PENDING' as const,
                    };
                  });
                  totalAmount += subCheckTotal;
                  return {
                    label: subCheck.label,
                    subtotal: subCheckTotal,
                    items: { create: items },
                  };
                }),
              },
              totalAmount,
              grandTotal: totalAmount,
            },
            include: createdOrderInclude,
          });
          newItemIds = persistedOrder.subChecks.flatMap((subCheck: any) =>
            subCheck.items.map((item: any) => item.id),
          );

          if (data.tableId) await orderService.syncTableStatus(tenantId, data.tableId, tx);
          logger.info(`Order created: ${orderNumber}`);
        }

        if (idempotencyKey) {
          await tx.orderCommand.update({
            where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
            data: { orderId: persistedOrder.id, createdItemIds: newItemIds },
          });
        }

        return { order: { ...persistedOrder, newItemIds }, isReplay: false };
      });

      return result;
    } catch (error) {
      const isUniqueConflict =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (isUniqueConflict && idempotencyKey && payloadHash) {
        const replay = await loadIdempotentReplay(tenantId, idempotencyKey, payloadHash);
        if (replay) return replay;
      }
      throw error;
    }
  },

  async updateStatus(tenantId: string, orderId: string, status: string, paymentMethod?: string, amount?: number) {
    return prisma.$transaction(async (tx) => {
      const existingOrder = await tx.order.findUnique({ where: { id: orderId } });
      if (!existingOrder) throw new Error('Order not found');

      let newStatus = status as any;
      let newPaidAmount = existingOrder.paidAmount;
      let newPayments = Array.isArray(existingOrder.payments) ? [...existingOrder.payments] : [];

      if (amount !== undefined && amount > 0) {
        newPaidAmount += amount;
        newPayments.push({
          amount,
          method: paymentMethod || 'CASH',
          date: new Date().toISOString()
        });
        
        // Auto-complete if fully paid
        if (newPaidAmount >= existingOrder.grandTotal) {
          newStatus = 'COMPLETED';
        } else if (status === 'COMPLETED') {
          // If they explicitly requested complete but amount isn't enough, we might just leave it pending
          // or we trust the status. For safety, keep it PENDING if not fully paid unless they meant it.
          // Since they are making a partial payment, we set it back to PENDING if not fully paid.
          newStatus = 'PENDING';
        }
      }

      const order = await tx.order.update({
        where: { id: orderId, tenantId },
        data: {
          status: newStatus,
          paidAmount: newPaidAmount,
          payments: newPayments,
          ...(newStatus === 'COMPLETED' ? { 
            completedAt: new Date(),
            paymentMethod: paymentMethod || 'CASH'
          } : {
            completedAt: null,
            paymentMethod: paymentMethod || existingOrder.paymentMethod
          }),
        },
        include: { subChecks: { include: { items: true } } },
      });

      // Sync table status
      if (order.tableId) {
        await this.syncTableStatus(tenantId, order.tableId, tx);
      }

      return order;
    });
  },

  async updateItemStatus(tenantId: string, orderId: string, itemId: string, status: string, notes?: string) {
    // Verify order belongs to tenant
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 });

    // Kalem, dogrulanan siparise ait olmali. Yalnizca itemId ile arandiginda
    // kullanici kendi orderId'si + baska bir kiracinin itemId'si ile o kalemi
    // degistirebiliyordu; yukaridaki order/tenant kontrolu kalemi kapsamiyor.
    // OrderItem, Order'a SubCheck uzerinden baglidir.
    const currentItem = await prisma.orderItem.findFirst({
      where: { id: itemId, subCheck: { orderId } },
    });
    if (!currentItem) throw Object.assign(new Error('Item not found'), { statusCode: 404 });

    const updateData: any = { status: status as any };
    if (notes !== undefined) updateData.notes = notes;

    // If marked as Ikram, set isTreat and drop the price to 0
    if (notes && notes.includes('[İKRAM]')) {
      updateData.totalPrice = 0;
      updateData.isTreat = true;
    } else if (currentItem.isTreat && (!notes || !notes.includes('[İKRAM]'))) {
      // Revert if removed
      updateData.isTreat = false;
      const extrasTotal = (currentItem.extras as any[] || []).reduce((sum, e) => sum + e.price, 0);
      updateData.totalPrice = (currentItem.unitPrice * currentItem.portionMultiplier + extrasTotal) * currentItem.quantity;
    }

    const updatedItem = await prisma.orderItem.update({
      where: { id: itemId },
      data: updateData,
    });

    // Recalculate totals for subChecks and order
    await this.recalculateOrderTotals(tenantId, orderId);

    // Fis SADECE gercek bir durum degisiminde basilir (bkz. print-triggers).
    // Kontrolun sunucuda olmasi sart — istemci tarafi koruma, ag tekrarlarini
    // ve diger panelleri kapsamaz.
    const trigger = resolveItemPrintTrigger(
      { status: currentItem.status, isTreat: currentItem.isTreat },
      status,
      Boolean(updateData.isTreat),
    );

    if (trigger) {
      printService.printItemUpdate(tenantId, orderId, itemId, trigger).catch(err => {
        logger.error(`Failed to print item update for ${itemId}:`, err);
      });
    }

    return updatedItem;
  },

  async updateItemQuantity(tenantId: string, orderId: string, itemId: string, quantity: number) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
    });
    if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 });

    // Kalem, dogrulanan siparise ait olmali. Yalnizca itemId ile arandiginda
    // kullanici kendi orderId'si + baska bir kiracinin itemId'si ile o kalemi
    // degistirebiliyordu; yukaridaki order/tenant kontrolu kalemi kapsamiyor.
    // OrderItem, Order'a SubCheck uzerinden baglidir.
    const currentItem = await prisma.orderItem.findFirst({
      where: { id: itemId, subCheck: { orderId } },
    });
    if (!currentItem) throw Object.assign(new Error('Item not found'), { statusCode: 404 });

    const extrasTotal = (currentItem.extras as any[] || []).reduce((sum, e) => sum + e.price, 0);
    const totalPrice = currentItem.isTreat ? 0 : (currentItem.unitPrice * currentItem.portionMultiplier + extrasTotal) * quantity;

    const updatedItem = await prisma.orderItem.update({
      where: { id: itemId },
      data: { quantity, totalPrice },
    });

    await this.recalculateOrderTotals(tenantId, orderId);

    return updatedItem;
  },

  async recalculateOrderTotals(tenantId: string, orderId: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { subChecks: { include: { items: true } } }
    });
    if (!order) return;

    let orderTotalAmount = 0;
    let totalItems = 0;
    let cancelledItems = 0;

    // Recalculate each subCheck in parallel
    const subCheckUpdates = order.subChecks.map(async (subCheck) => {
      totalItems += subCheck.items.length;
      
      const activeItems = subCheck.items.filter(item => item.status !== 'CANCELLED');
      const currentCancelled = subCheck.items.length - activeItems.length;
      cancelledItems += currentCancelled;

      const subCheckTotal = activeItems.reduce((sum, item) => sum + item.totalPrice, 0);
      orderTotalAmount += subCheckTotal;

      return prisma.subCheck.update({
        where: { id: subCheck.id },
        data: { subtotal: subCheckTotal }
      });
    });

    await Promise.all(subCheckUpdates);

    // Determine if the order should be automatically cancelled
    const shouldAutoCancel = totalItems > 0 && totalItems === cancelledItems;
    const newStatus = shouldAutoCancel ? 'CANCELLED' : order.status;

    // Update main order
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: newStatus as any,
        totalAmount: orderTotalAmount,
        grandTotal: orderTotalAmount // Tax/Service charge logic can be reapplied if needed
      }
    });

    // Sync table status
    if (order.tableId) {
      await this.syncTableStatus(tenantId, order.tableId);
    }
  },

  async getBillData(tenantId: string, orderId: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        table: true,
        customer: true,
        waiter: { select: { name: true } },
        subChecks: {
          include: { items: true },
        },
        tenant: { select: { name: true, logo: true } }
      },
    });

    if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 });

    const allItems = order.subChecks.flatMap(sc => sc.items);
    
    // Group similar items for the bill (e.g. 2 separate Ayran orders → 2x Ayran)
    const groupedItems: Record<string, { name: string; quantity: number; price: number }> = {};
    
    for (const item of allItems) {
      let isCancelled = item.status === 'CANCELLED';
      let isIkram = item.isTreat;

      let suffix = '';
      if (isCancelled) suffix = ' [İPTAL]';
      else if (isIkram) suffix = ' [İKRAM]';
      
      const key = `${item.menuItemName}-${item.portionOption}${suffix}`;
      
      if (groupedItems[key]) {
        groupedItems[key]!.quantity += item.quantity;
        groupedItems[key]!.price += isCancelled ? 0 : item.totalPrice;
      } else {
        const portionStr = item.portionOption !== 'Normal' ? ` (${item.portionOption})` : '';
        groupedItems[key] = {
          name: item.menuItemName + portionStr + suffix,
          quantity: item.quantity,
          price: isCancelled ? 0 : item.totalPrice
        };
      }
    }

    return {
      restaurantName: order.tenant.name,
      orderNumber: order.orderNumber,
      tableNumber: order.table?.number,
      customerName: order.customer?.name,
      waiterName: order.waiter?.name,
      items: Object.values(groupedItems),
      total: order.grandTotal,
      timestamp: new Date(),
    };
  },

  async transferTable(tenantId: string, orderId: string, newTableId: string) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, tenantId },
        include: { table: true }
      });

      if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 });
      if (!order.tableId) throw Object.assign(new Error('Takeaway siparişleri masaya aktarılamaz'), { statusCode: 400 });
      if (order.tableId === newTableId) throw Object.assign(new Error('Masalar aynı'), { statusCode: 400 });

      const newTable = await tx.restaurantTable.findFirst({
        where: { id: newTableId, tenantId }
      });

      if (!newTable) throw Object.assign(new Error('Yeni masa bulunamadı'), { statusCode: 404 });

      // 1. Update order table
      const updatedOrder = await tx.order.update({
        where: { id: orderId, tenantId },
        data: { tableId: newTableId },
        include: {
          table: { select: { number: true, zone: true } },
          waiter: { select: { name: true } },
          subChecks: { include: { items: true } },
        }
      });

      // 2. Mark new table as OCCUPIED
      await this.syncTableStatus(tenantId, newTableId, tx);

      // 3. Mark old table as AVAILABLE if it has no other active orders
      if (order.tableId) {
        await this.syncTableStatus(tenantId, order.tableId, tx);
      }

      logger.info(`Order ${order.orderNumber} transferred from Table ${order.table?.number} to Table ${newTable.number}`);
      return updatedOrder;
    });
  },

  async deleteAll(tenantId: string, isDeletedOnly: boolean = false) {
    if (isDeletedOnly) {
      return prisma.order.deleteMany({ where: { tenantId, isDeleted: true } });
    }
    // Normal clear: Soft delete all active orders
    await prisma.order.updateMany({
      where: { tenantId, isDeleted: false },
      data: { isDeleted: true, status: 'CANCELLED' }
    });

    // CRITICAL FIX: Also reset all tables for this tenant
    return prisma.restaurantTable.updateMany({
      where: { tenantId },
      data: { status: 'AVAILABLE' }
    });
  },

  async delete(tenantId: string, id: string) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id, tenantId } });
      if (!order) throw Object.assign(new Error('Order not found'), { statusCode: 404 });

      // Soft Delete (Mark Cancelled & isDeleted)
      const updated = await tx.order.update({
        where: { id },
        data: { isDeleted: true, status: 'CANCELLED' }
      });

      if (updated.tableId) {
        await this.syncTableStatus(tenantId, updated.tableId, tx);
      }

      return updated;
    });
  },

  async toggleHide(tenantId: string, orderId: string) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({ where: { id: orderId, tenantId } });
      if (!existing) throw new Error('Order not found');
      return tx.order.update({
        where: { id: orderId, tenantId },
        data: { isDeleted: !existing.isDeleted }
      });
    });
  },
};
