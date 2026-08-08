import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  normalizeLayout,
  type PrintLayoutKey,
} from '@rest-otm/receipt-core';
import {
  GRILL_STATION_DEPARTMENTS,
  KITCHEN_STATION_DEPARTMENTS,
  resolvePreparationDepartment,
} from '../../utils/department-routing';
import { enqueuePrintJob } from './print-outbox.service';

type DbClient = Prisma.TransactionClient;

function readSettings(value: unknown): Record<string, any> {
  if (typeof value !== 'string') return (value || {}) as Record<string, any>;
  try { return JSON.parse(value); } catch { return {}; }
}

function layoutFor(
  settings: Record<string, any>,
  printerId: string,
  fallback: PrintLayoutKey,
  restaurantName: string,
) {
  const assigned = settings.printerLayoutAssignments?.[printerId];
  const layoutKey = ['KITCHEN', 'GRILL', 'CASHIER', 'PAKET'].includes(assigned)
    ? assigned as PrintLayoutKey
    : fallback;
  return normalizeLayout(settings.printLayouts?.[layoutKey], layoutKey, restaurantName);
}

export async function buildStationPrintSnapshot(
  client: DbClient,
  tenantId: string,
  orderId: string,
  department: 'KITCHEN' | 'GRILL',
  itemIds: string[],
  options: { isCancel?: boolean; isTreat?: boolean } = {},
) {
  const order = await client.order.findFirst({
    where: { id: orderId, tenantId, isDeleted: false },
    include: {
      subChecks: { include: { items: true } },
      table: true,
      waiter: { select: { name: true } },
    },
  });
  if (!order) throw new Error('Sipariş bulunamadı');

  const allItems = order.subChecks.flatMap((subCheck) => subCheck.items);
  const menuItems = await client.menuItem.findMany({
    where: { tenantId, id: { in: allItems.map((item) => item.menuItemId) } },
    select: { id: true, department: true, category: { select: { name: true } } },
  });
  const menuMap = new Map(menuItems.map((item) => [item.id, item]));
  const allowed = department === 'KITCHEN'
    ? KITCHEN_STATION_DEPARTMENTS
    : GRILL_STATION_DEPARTMENTS;
  const selected = new Set(itemIds);
  const items = allItems
    .filter((item) => {
      const menuItem = menuMap.get(item.menuItemId);
      const effective = resolvePreparationDepartment(
        menuItem?.department || item.department,
        menuItem?.category.name,
      );
      const statusMatches = options.isCancel
        ? item.status === 'CANCELLED'
        : item.status !== 'CANCELLED';
      return selected.has(item.id) && statusMatches && allowed.has(effective);
    })
    .map((item) => ({
      menuItemName: item.menuItemName,
      quantity: item.quantity,
      price: item.quantity > 0 ? item.totalPrice / item.quantity : item.totalPrice,
      portionOption: item.portionOption || 'Normal',
      notes: item.notes || null,
      isCancel: options.isCancel,
      isTreat: options.isTreat || item.isTreat,
    }));
  if (items.length === 0) return null;

  let printer = await client.printerConfig.findFirst({
    where: { tenantId, isActive: true, departments: { has: department } },
  });
  if (!printer) {
    const namePart = department === 'KITCHEN' ? 'Fır' : 'Izgara';
    printer = await client.printerConfig.findFirst({
      where: { tenantId, isActive: true, name: { contains: namePart, mode: 'insensitive' } },
    });
  }
  if (!printer?.ipAddress) {
    throw new Error(`${department} istasyonu için aktif ve IP tanımlı yazıcı yok`);
  }

  const tenant = await client.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, settings: true },
  });
  const settings = readSettings(tenant?.settings);
  const layout = layoutFor(settings, printer.id, department, tenant?.name || 'REST_OTM');
  if (options.isCancel) {
    layout.receiptTitle = 'İPTAL FİŞİ';
    (layout as any).isCancel = true;
  } else if (options.isTreat) {
    layout.receiptTitle = 'İKRAM FİŞİ';
    (layout as any).isTreat = true;
  }

  return {
    printerId: printer.id,
    printerName: printer.name,
    payload: {
      department,
      ipAddress: printer.ipAddress,
      port: printer.port || 9100,
      orderNumber: order.orderNumber,
      tableNumber: order.table?.number || 0,
      waiterName: order.waiter?.name || '',
      items,
      layout,
      orderData: {
        id: order.id,
        orderNumber: order.orderNumber,
        grandTotal: order.grandTotal,
        table: order.table,
        waiter: order.waiter,
        subChecks: order.subChecks,
      },
    } as unknown as Prisma.InputJsonObject,
  };
}

function itemSetKey(itemIds: string[]): string {
  return createHash('sha256').update([...itemIds].sort().join('\n')).digest('hex').slice(0, 24);
}

export async function enqueueProductionStationJobs(
  client: DbClient,
  tenantId: string,
  orderId: string,
  itemIds: string[],
  idempotencyBase = itemSetKey(itemIds),
): Promise<void> {
  for (const department of ['KITCHEN', 'GRILL'] as const) {
    try {
      const snapshot = await buildStationPrintSnapshot(
        client,
        tenantId,
        orderId,
        department,
        itemIds,
      );
      if (!snapshot) continue;
      await enqueuePrintJob({
        tenantId,
        orderId,
        printerId: snapshot.printerId,
        eventName: 'print:kitchen',
        eventKey: `ORDER_ITEMS:${department}`,
        idempotencyKey: `order:${idempotencyBase}:${department}`,
        payload: snapshot.payload,
      }, client);
    } catch (error) {
      await enqueuePrintJob({
        tenantId,
        orderId,
        eventName: 'print:kitchen',
        eventKey: `ORDER_ITEMS:${department}`,
        idempotencyKey: `order:${idempotencyBase}:${department}:unroutable`,
        payload: { department, orderId, itemIds },
        initialError: error instanceof Error ? error.message : String(error),
      }, client);
    }
  }
}

export async function enqueueItemUpdatePrintJob(
  client: DbClient,
  tenantId: string,
  orderId: string,
  itemId: string,
  updateType: 'CANCEL' | 'TREAT',
  transitionId: string,
): Promise<void> {
  for (const department of ['KITCHEN', 'GRILL'] as const) {
    try {
      const snapshot = await buildStationPrintSnapshot(
        client,
        tenantId,
        orderId,
        department,
        [itemId],
        { isCancel: updateType === 'CANCEL', isTreat: updateType === 'TREAT' },
      );
      if (!snapshot) continue;
      await enqueuePrintJob({
        tenantId,
        orderId,
        printerId: snapshot.printerId,
        eventName: 'print:kitchen',
        eventKey: `ITEM_${updateType}:${department}`,
        idempotencyKey: `item:${itemId}:${updateType}:${transitionId}`,
        payload: snapshot.payload,
      }, client);
      return;
    } catch (error) {
      await enqueuePrintJob({
        tenantId,
        orderId,
        eventName: 'print:kitchen',
        eventKey: `ITEM_${updateType}:${department}`,
        idempotencyKey: `item:${itemId}:${updateType}:${transitionId}:unroutable`,
        payload: { department, orderId, itemId, updateType },
        initialError: error instanceof Error ? error.message : String(error),
      }, client);
      return;
    }
  }
}
