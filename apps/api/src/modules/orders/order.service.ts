// ==========================================
// Order Service — Core Business Logic
// ==========================================

import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { resolvePreparationDepartment } from '../../utils/department-routing';
import { resolveItemPrintTrigger } from '../../utils/print-triggers';
import { printService } from '../printing/print.service';


/** Generate a unique order number per tenant (e.g. ORD-001, ORD-002) */
async function generateOrderNumber(tenantId: string): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const count = await prisma.order.count({
    where: {
      tenantId,
      createdAt: { gte: today },
    },
  });

  const number = (count + 1).toString().padStart(3, '0');
  return `ORD-${number}`;
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

  async create(tenantId: string, waiterId: string | null, data: {
    type?: string;
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
  }) {
    let finalCustomerId = data.customerId;

    // Auto-create/lookup customer if manual details provided
    if (!finalCustomerId && data.customerName) {
      const existingCustomer = await prisma.customer.findFirst({
        where: {
          tenantId,
          phone: data.customerPhone || undefined,
          name: { equals: data.customerName, mode: 'insensitive' }
        }
      });

      if (existingCustomer) {
        finalCustomerId = existingCustomer.id;
      } else {
        const newCustomer = await prisma.customer.create({
          data: {
            tenantId,
            name: data.customerName,
            phone: data.customerPhone || '',
            address: data.customerAddress || ''
          }
        });
        finalCustomerId = newCustomer.id;
      }
    }

    const menuItemIds = data.subChecks.flatMap((sc) =>
      sc.items.map((item) => item.menuItemId),
    );
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, tenantId },
      include: { category: { select: { name: true } } },
    });
    const menuItemMap = new Map(menuItems.map((mi) => [mi.id, mi]));

    // Check if an active order already exists for this table
    // Tip acikca yazilir: strictNullChecks altinda `= null` baslangici tek
    // basina `null` tipine cozulur ve sonraki atama hata verir.
    let existingOrder: Awaited<ReturnType<typeof prisma.order.findFirst>> = null;
    if (data.tableId && data.type !== 'TAKEAWAY') {
      existingOrder = await prisma.order.findFirst({
        where: {
          tenantId,
          tableId: data.tableId,
          isDeleted: false,
          status: { notIn: ['COMPLETED', 'CANCELLED'] }
        }
      });
    }

    if (existingOrder) {
      // `const`'a alinir: `let` uzerindeki daraltma asagidaki transaction
      // geri cagirmasi icinde kaybolur, boylece `!` kullanmaya gerek kalmaz.
      const activeOrder = existingOrder;

      // Append items to existing order
      let totalAddedAmount = 0;
      const newItemIds: string[] = [];

      const updatedOrder = await prisma.$transaction(async (tx) => {
        for (const sc of data.subChecks) {
          let subCheckTotal = 0;
          const items = sc.items.map((item) => {
            const menuItem = menuItemMap.get(item.menuItemId);
            if (!menuItem) throw new Error(`Menu item ${item.menuItemId} not found`);

            const multiplier = item.portionMultiplier || 1;
            const extrasTotal = (item.extras || []).reduce((sum, e) => sum + e.price, 0);
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
              department: resolvePreparationDepartment(
                menuItem.department,
                menuItem.category.name,
              ),
              status: 'PENDING' as const,
            };
          });
          
          totalAddedAmount += subCheckTotal;

          const createdSubCheck = await tx.subCheck.create({
            data: {
              orderId: activeOrder.id,
              label: sc.label,
              subtotal: subCheckTotal,
              items: { create: items }
            },
            include: { items: { select: { id: true } } },
          });
          newItemIds.push(...createdSubCheck.items.map((item) => item.id));
        }

        const persistedOrder = await tx.order.update({
          where: { id: activeOrder.id },
          data: {
            totalAmount: { increment: totalAddedAmount },
            grandTotal: { increment: totalAddedAmount },
          },
          include: {
            table: { select: { number: true, zone: true } },
            customer: true,
            waiter: { select: { name: true } },
            subChecks: { include: { items: true } },
          }
        });
        return { ...persistedOrder, newItemIds };
      });

      logger.info(`Appended items to existing order: ${activeOrder.orderNumber}`);
      return updatedOrder;
    }

    // Otherwise, create a new order
    const orderNumber = await generateOrderNumber(tenantId);
    let totalAmount = 0;

    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
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
            create: data.subChecks.map((sc) => {
              let subCheckTotal = 0;

              const items = sc.items.map((item) => {
                const menuItem = menuItemMap.get(item.menuItemId);
                if (!menuItem) throw new Error(`Menu item ${item.menuItemId} not found`);

                const multiplier = item.portionMultiplier || 1;
                const extrasTotal = (item.extras || []).reduce((sum, e) => sum + e.price, 0);
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
                  department: resolvePreparationDepartment(
                    menuItem.department,
                    menuItem.category.name,
                  ),
                  status: 'PENDING' as const,
                };
              });

              totalAmount += subCheckTotal;

              return {
                label: sc.label,
                subtotal: subCheckTotal,
                items: { create: items },
              };
            }),
          },
          totalAmount,
          grandTotal: totalAmount,
        },
        include: {
          table: { select: { number: true, zone: true } },
          customer: true,
          waiter: { select: { name: true } },
          subChecks: { include: { items: true } },
        },
      });

      // Ensure table status is updated
      if (data.tableId) {
        await this.syncTableStatus(tenantId, data.tableId, tx);
      }

      return newOrder;
    });

    logger.info(`Order created: ${orderNumber}`);

    return {
      ...order,
      newItemIds: order.subChecks.flatMap((subCheck) => subCheck.items.map((item) => item.id)),
    };
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
