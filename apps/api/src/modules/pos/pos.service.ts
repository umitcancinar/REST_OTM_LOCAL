import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';

export const posService = {
  /**
   * Starts a POS payment transaction
   */
  async startPayment(tenantId: string, orderId: string, amount: number) {
    // 1. Find POS device for this tenant
    // We look for a PrinterConfig with type 'POS' or containing 'POS' in the name
    const posDevice = await prisma.printerConfig.findFirst({
      where: {
        tenantId,
        isActive: true,
        OR: [
          { type: 'POS' },
          { name: { contains: 'POS', mode: 'insensitive' } }
        ]
      }
    });

    if (!posDevice) {
      throw new Error('Aktif bir POS cihazı bulunamadı. Lütfen Ayarlar > Yazıcılar kısmından bir POS cihazı tanımlayın (Türü POS olmalı).');
    }

    if (!posDevice.ipAddress || !posDevice.port) {
      throw new Error(`POS cihazı (${posDevice.name}) için IP veya Port adresi eksik.`);
    }

    const paymentId = `pay-${orderId}-${Date.now()}`;

    // 2. Build the payment job
    const paymentJob = {
      paymentId,
      amount,
      posIp: posDevice.ipAddress,
      posPort: posDevice.port,
    };

    // 3. Emit via WebSocket to Print Agent
    const { getIO } = await import('../../websocket/socket.server');
    const io = getIO();
    io.to(`tenant:${tenantId}`).emit('payment:start', paymentJob);

    logger.info(`💳 POS Payment request sent: ${paymentId} → ${posDevice.name} (${posDevice.ipAddress}:${posDevice.port}) | Amount: ${amount} TL`);

    return { paymentId, posName: posDevice.name };
  }
};
