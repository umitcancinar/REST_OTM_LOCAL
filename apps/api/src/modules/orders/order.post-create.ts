import type { Server } from 'socket.io';
import { inventoryService } from '../inventory/inventory.service';
import { printService } from '../printing/print.service';
import { logger } from '../../utils/logger';
import {
  resolvePreparationDepartment,
  STATION_PRINT_DEPARTMENTS,
  KITCHEN_STATION_DEPARTMENTS,
  GRILL_STATION_DEPARTMENTS,
} from '../../utils/department-routing';

// NOTE: BAR (içecek) is intentionally excluded from station prints but appears on the adisyon.
// KITCHEN_STATION_DEPARTMENTS = KITCHEN | COLD | PASTRY
// GRILL_STATION_DEPARTMENTS   = GRILL
// STATION_PRINT_DEPARTMENTS   = union of both

/**
 * Runs the side effects for only the lines created by the current request.
 * This prevents an existing table's older items from being printed or deducted
 * from stock a second time when new items are appended.
 */
export async function processCreatedOrder(
  tenantId: string,
  order: any,
  io: Server,
  room: string,
  printToKitchen: boolean,
) {
  const allItems = order.subChecks?.flatMap((subCheck: any) => subCheck.items || []) || [];
  const createdIds = new Set<string>(
    Array.isArray(order.newItemIds) && order.newItemIds.length > 0
      ? order.newItemIds
      : allItems.map((item: any) => item.id),
  );
  const newItems = allItems.filter((item: any) => createdIds.has(item.id));

  // Resolve the effective department for each item so we use the same logic
  // as _printToStation (category-based override for legacy KITCHEN defaults).
  const resolvedItems: Array<{ item: any; effectiveDept: string }> = newItems.map((item: any) => ({
    item,
    effectiveDept: resolvePreparationDepartment(
      item.department,
      item.categoryName ?? item.menuItem?.category?.name ?? null,
    ),
  }));

  const stationItems = resolvedItems.filter(({ effectiveDept }) =>
    STATION_PRINT_DEPARTMENTS.has(effectiveDept as any),
  );

  if (printToKitchen && stationItems.length > 0) {
    const itemIds = stationItems.map(({ item }) => item.id);
    void printService.printProductionStations(tenantId, order.id, itemIds).then((result) => {
      if (result.queued) logger.error(`Otomatik mutfak baskısı kısmen/tamamen başarısız: ${result.error}`);
    }).catch((error) => logger.error('Otomatik mutfak baskısı başlatılamadı:', error));
  }

  // Emit kitchen display event for KITCHEN + GRILL items only (not BAR/beverages)
  const kitchenDisplayItems = stationItems.map(({ item }) => item);
  if (kitchenDisplayItems.length > 0) {
    io.to(room).emit('kitchen:new_items', {
      items: kitchenDisplayItems,
      orderId: order.id,
      tableNumber: order.table?.number || 0,
    });
  }

  try {
    await inventoryService.deductStockForOrder(
      tenantId,
      newItems.map((item: any) => ({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        portionMultiplier: item.portionMultiplier || 1,
      })),
    );

    const alerts = await inventoryService.getStockAlerts(tenantId);
    if (alerts.length > 0) {
      io.to(room).emit('inventory:stock_alert', { alerts });
    }
  } catch (error) {
    // The order has already committed. Preserve it and surface the operational
    // problem to logs instead of returning a false "order creation failed".
    logger.error(`Sipariş ${order.orderNumber} stok işlemleri tamamlanamadı:`, error);
  }
}
