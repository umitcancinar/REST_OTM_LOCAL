import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { getIO } from '../../websocket/socket.server';

/**
 * Cleanup task that runs periodically to free up tables that have been 
 * occupied for more than 2 hours without any activity.
 */
export async function runTableCleanupTask() {
  try {
    const twoHoursAgo = new Date();
    twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

    // Find tables that are OCCUPIED and haven't been updated in 2 hours
    const staleTables = await prisma.restaurantTable.findMany({
      where: {
        status: 'OCCUPIED',
        updatedAt: { lt: twoHoursAgo }
      }
    });

    if (staleTables.length === 0) return;

    logger.info(`🧹 Cleanup: Found ${staleTables.length} stale tables. Processing...`);

    for (const table of staleTables) {
      // 1. Find and cancel stale orders for this table
      const staleOrders = await prisma.order.findMany({
        where: {
          tableId: table.id,
          tenantId: table.tenantId,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          isDeleted: false
        }
      });

      if (staleOrders.length > 0) {
        await prisma.order.updateMany({
          where: { id: { in: staleOrders.map(o => o.id) } },
          data: { 
            status: 'CANCELLED', 
            isDeleted: true,
            notes: (table.status as string) + ' [OTOMATİK İPTAL - 2 SAAT SİSTEM TEMİZLİĞİ]'
          }
        });
      }

      // 2. Free up the table
      await prisma.restaurantTable.update({
        where: { id: table.id },
        data: { status: 'AVAILABLE' }
      });

      // 3. Notify clients via Socket.io
      try {
        const io = getIO();
        io.to(`tenant:${table.tenantId}`).emit('table:status_changed', { tableId: table.id, status: 'AVAILABLE' });
        io.to(`tenant:${table.tenantId}`).emit('order:updated');
      } catch (ioErr) {
        // Socket might not be initialized yet or other issues, ignore
      }

      logger.info(`✅ Table ${table.number} (Tenant: ${table.tenantId}) auto-emptied after 2 hours of inactivity.`);
    }

  } catch (error) {
    logger.error('❌ Error during table cleanup task:', error);
  }
}

/**
 * Initialize the cleanup interval
 */
export function initCleanupTask() {
  // Delay first run by 30 seconds to let DB connection stabilize
  setTimeout(() => {
    runTableCleanupTask();
  }, 30 * 1000);
  
  // Run every 60 minutes (reduced from 15 to avoid unnecessary Neon DB wakeups)
  setInterval(() => {
    runTableCleanupTask();
  }, 60 * 60 * 1000);
}
