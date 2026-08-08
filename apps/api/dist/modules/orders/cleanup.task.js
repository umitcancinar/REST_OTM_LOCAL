"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTableCleanupTask = runTableCleanupTask;
exports.initCleanupTask = initCleanupTask;
const database_1 = __importDefault(require("../../config/database"));
const logger_1 = require("../../utils/logger");
const socket_server_1 = require("../../websocket/socket.server");
/**
 * Cleanup task that runs periodically to free up tables that have been
 * occupied for more than 2 hours without any activity.
 */
async function runTableCleanupTask() {
    try {
        const twoHoursAgo = new Date();
        twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);
        // Find tables that are OCCUPIED and haven't been updated in 2 hours
        const staleTables = await database_1.default.restaurantTable.findMany({
            where: {
                status: 'OCCUPIED',
                updatedAt: { lt: twoHoursAgo }
            }
        });
        if (staleTables.length === 0)
            return;
        logger_1.logger.info(`🧹 Cleanup: Found ${staleTables.length} stale tables. Processing...`);
        for (const table of staleTables) {
            // 1. Find and cancel stale orders for this table
            const staleOrders = await database_1.default.order.findMany({
                where: {
                    tableId: table.id,
                    tenantId: table.tenantId,
                    status: { notIn: ['COMPLETED', 'CANCELLED'] },
                    isDeleted: false
                }
            });
            if (staleOrders.length > 0) {
                await database_1.default.order.updateMany({
                    where: { id: { in: staleOrders.map(o => o.id) } },
                    data: {
                        status: 'CANCELLED',
                        isDeleted: true,
                        notes: table.status + ' [OTOMATİK İPTAL - 2 SAAT SİSTEM TEMİZLİĞİ]'
                    }
                });
            }
            // 2. Free up the table
            await database_1.default.restaurantTable.update({
                where: { id: table.id },
                data: { status: 'AVAILABLE' }
            });
            // 3. Notify clients via Socket.io
            try {
                const io = (0, socket_server_1.getIO)();
                io.to(`tenant:${table.tenantId}`).emit('table:status_changed', { tableId: table.id, status: 'AVAILABLE' });
                io.to(`tenant:${table.tenantId}`).emit('order:updated');
            }
            catch (ioErr) {
                // Socket might not be initialized yet or other issues, ignore
            }
            logger_1.logger.info(`✅ Table ${table.number} (Tenant: ${table.tenantId}) auto-emptied after 2 hours of inactivity.`);
        }
    }
    catch (error) {
        logger_1.logger.error('❌ Error during table cleanup task:', error);
    }
}
/**
 * Initialize the cleanup interval
 */
function initCleanupTask() {
    // Delay first run by 30 seconds to let DB connection stabilize
    setTimeout(() => {
        runTableCleanupTask();
    }, 30 * 1000);
    // Run every 60 minutes (reduced from 15 to avoid unnecessary Neon DB wakeups)
    setInterval(() => {
        runTableCleanupTask();
    }, 60 * 60 * 1000);
}
//# sourceMappingURL=cleanup.task.js.map