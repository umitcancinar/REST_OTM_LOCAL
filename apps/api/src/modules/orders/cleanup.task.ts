import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { getIO } from '../../websocket/socket.server';

/**
 * Cleanup task that runs periodically to free up tables that have been 
 * occupied for more than 2 hours without any activity.
 */
export async function runTableCleanupTask(assertOperationalLicense?: () => void) {
  try {
    assertOperationalLicense?.();
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
      // Acik adisyonu zaman gecmis diye otomatik iptal etmek finansal veri
      // kaybidir. Yalnizca acik adisyonu olmayan unutulmus masayi serbest birak.
      const staleOrders = await prisma.order.findMany({
        where: {
          tableId: table.id,
          tenantId: table.tenantId,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          isDeleted: false
        }
      });

      if (staleOrders.length > 0) {
        logger.warn(
          `Cleanup: Masa ${table.number} acik adisyon tasidigi icin otomatik kapatilmadi.`,
        );
        continue;
      }

      // Acik adisyon yoksa masanin durumu guvenle duzeltilebilir.
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
export function initCleanupTask(assertOperationalLicense?: () => void): () => void {
  // Delay first run by 30 seconds to let DB connection stabilize
  const initialTimer = setTimeout(() => {
    void runTableCleanupTask(assertOperationalLicense);
  }, 30 * 1000);
  if (typeof initialTimer.unref === 'function') initialTimer.unref();
  
  // Run every 60 minutes (reduced from 15 to avoid unnecessary Neon DB wakeups)
  const intervalTimer = setInterval(() => {
    void runTableCleanupTask(assertOperationalLicense);
  }, 60 * 60 * 1000);
  if (typeof intervalTimer.unref === 'function') intervalTimer.unref();

  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}
