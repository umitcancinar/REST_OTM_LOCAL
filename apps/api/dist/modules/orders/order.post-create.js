"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processCreatedOrder = processCreatedOrder;
const inventory_service_1 = require("../inventory/inventory.service");
const print_service_1 = require("../printing/print.service");
const logger_1 = require("../../utils/logger");
const department_routing_1 = require("../../utils/department-routing");
// NOTE: BAR (içecek) is intentionally excluded from station prints but appears on the adisyon.
// KITCHEN_STATION_DEPARTMENTS = KITCHEN | COLD | PASTRY
// GRILL_STATION_DEPARTMENTS   = GRILL
// STATION_PRINT_DEPARTMENTS   = union of both
/**
 * Runs the side effects for only the lines created by the current request.
 * This prevents an existing table's older items from being printed or deducted
 * from stock a second time when new items are appended.
 */
async function processCreatedOrder(tenantId, order, io, room, printToKitchen) {
    const allItems = order.subChecks?.flatMap((subCheck) => subCheck.items || []) || [];
    const createdIds = new Set(Array.isArray(order.newItemIds) && order.newItemIds.length > 0
        ? order.newItemIds
        : allItems.map((item) => item.id));
    const newItems = allItems.filter((item) => createdIds.has(item.id));
    // Resolve the effective department for each item so we use the same logic
    // as _printToStation (category-based override for legacy KITCHEN defaults).
    const resolvedItems = newItems.map((item) => ({
        item,
        effectiveDept: (0, department_routing_1.resolvePreparationDepartment)(item.department, item.categoryName ?? item.menuItem?.category?.name ?? null),
    }));
    const stationItems = resolvedItems.filter(({ effectiveDept }) => department_routing_1.STATION_PRINT_DEPARTMENTS.has(effectiveDept));
    if (printToKitchen && stationItems.length > 0) {
        const itemIds = stationItems.map(({ item }) => item.id);
        void print_service_1.printService.printProductionStations(tenantId, order.id, itemIds).then((result) => {
            if (result.queued)
                logger_1.logger.error(`Otomatik mutfak baskısı kısmen/tamamen başarısız: ${result.error}`);
        }).catch((error) => logger_1.logger.error('Otomatik mutfak baskısı başlatılamadı:', error));
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
        await inventory_service_1.inventoryService.deductStockForOrder(tenantId, newItems.map((item) => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
            portionMultiplier: item.portionMultiplier || 1,
        })));
        const alerts = await inventory_service_1.inventoryService.getStockAlerts(tenantId);
        if (alerts.length > 0) {
            io.to(room).emit('inventory:stock_alert', { alerts });
        }
    }
    catch (error) {
        // The order has already committed. Preserve it and surface the operational
        // problem to logs instead of returning a false "order creation failed".
        logger_1.logger.error(`Sipariş ${order.orderNumber} stok işlemleri tamamlanamadı:`, error);
    }
}
//# sourceMappingURL=order.post-create.js.map