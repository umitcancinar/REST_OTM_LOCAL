// ==========================================
// Socket.io Server Setup
// ==========================================

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { timingSafeEqual } from 'crypto';
import { localEnv } from '../config/env.local';
import { logger } from '../utils/logger';
import prisma from '../config/database';
import { orderService } from '../modules/orders/order.service';
import { processCreatedOrder } from '../modules/orders/order.post-create';
import { parseOrderIdempotencyKey } from '../modules/orders/order-idempotency.policy';
import { printService } from '../modules/printing/print.service';
import { acknowledgePrintJob } from '../modules/printing/print-outbox.service';

let io: Server;

interface AuthenticatedSocket extends Socket {
  userId?: string;
  tenantId?: string;
  role?: string;
}

function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface SocketServerOptions {
  /** Her baglanti ve gelen olayda diskteki imzali lisansi yeniden dogrular. */
  assertOperationalLicense?: () => void;
}

export function initializeSocketServer(
  httpServer: HttpServer,
  options: SocketServerOptions = {},
): Server {
  io = new Server(httpServer, {
    cors: {
      origin: localEnv.CORS_ORIGIN,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ─── Authentication Middleware ──────────
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      options.assertOperationalLicense?.();
    } catch {
      return next(new Error('LOCAL_LICENSE_LOCKED'));
    }

    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
    const agentType = socket.handshake.auth.agentType;

    if (!token) {
      return next(new Error('Authentication token required'));
    }

    // Special authentication for Local Print Agent
    if (agentType === 'print-agent') {
      const declaredTenantId = socket.handshake.auth.tenantId as string | undefined;
      if (!declaredTenantId) {
        return next(new Error('Print Agent must provide a tenantId'));
      }

      // GUVENLIK: Eskiden tek bir global PRINT_AGENT_SECRET tum tenant'lar
      // icin ortakti ve agent'in bildirdigi tenantId DB'de dogrulanmiyordu —
      // sirri ele geciren biri, tenantId alanina baska bir restoranin ID'sini
      // yazarak o restoranin oda'sina katilabiliyordu (siparis/fis verisini
      // okuyabilir, sahte 'payment:completed' tetikleyebilirdi).
      // Artik sir + tenantId cifti DB'den dogrulaniyor. Tenant henuz kendi
      // sirrina sahip degilse (eski kayit, migration henuz calismamis)
      // GERIYE DONUK UYUMLULUK icin global sirra dusuluyor — boylece mevcut
      // canli kurulum kirilmiyor, sadece yeni/yenilenen tenant'lar izole olur.
      const tenant = await prisma.tenant.findUnique({
        where: { id: declaredTenantId },
        select: { id: true, printAgentSecret: true },
      });

      if (!tenant) {
        return next(new Error('Unknown tenant'));
      }

      const expectedSecret = tenant.printAgentSecret || localEnv.PRINT_AGENT_SECRET;

      // Sabit zamanli karsilastirma: zamanlama saldirisiyla sirrin
      // tahmin edilmesini zorlastirir.
      if (safeCompare(String(token), expectedSecret)) {
        socket.userId = 'print-agent';
        socket.role = 'PRINT_AGENT';
        socket.tenantId = declaredTenantId;
        return next();
      } else {
        return next(new Error('Invalid print agent secret'));
      }
    }

    // Standard JWT authentication for Web Clients
    try {
      const decoded = jwt.verify(token, localEnv.JWT_ACCESS_SECRET) as {
        userId: string;
        tenantId: string;
        role: string;
      };

      socket.userId = decoded.userId;
      socket.tenantId = decoded.tenantId;
      socket.role = decoded.role;
      next();
    } catch (err) {
      next(new Error('Invalid authentication token'));
    }
  });

  // ─── Connection Handler ─────────────────
  io.on('connection', (socket: AuthenticatedSocket) => {
    // Uzun sure acik kalan bir socket, lisans sonradan dolunca eski baglanti
    // uzerinden mutasyon yapamaz. Socket.IO paket middleware'i her gelen olayi
    // yeniden kapidan gecirir.
    socket.use((_packet, next) => {
      try {
        options.assertOperationalLicense?.();
        next();
      } catch {
        next(new Error('LOCAL_LICENSE_LOCKED'));
      }
    });

    const tenantRoom = `tenant:${socket.tenantId}`;
    socket.join(tenantRoom);
    if (socket.role === 'PRINT_AGENT') {
      socket.join(`${tenantRoom}:print-agents`);
    }

    logger.info(`🔌 Socket connected: ${socket.userId} (${socket.role}) → ${tenantRoom}`);

    // ─── Order Events ───────────────────────
    socket.on('order:create', async (data: { order: any; localId?: string }) => {
      try {
        const idempotencyKey = parseOrderIdempotencyKey(data.localId);
        const result = await orderService.create(
          socket.tenantId!,
          socket.userId!,
          data.order,
          { idempotencyKey },
        );
        const { order, isReplay } = result;

        if (!isReplay) {
          // A replay only acknowledges the original result. Re-broadcasting or
          // printing here would turn an idempotent retry into a duplicate side effect.
          io.to(tenantRoom).emit('order:new', { order });
          await processCreatedOrder(
            socket.tenantId!,
            order,
            io,
            tenantRoom,
            data.order?.printToKitchen !== false,
          );
        }

        // Acknowledge back to sender (with offline sync support)
        socket.emit('sync:confirmed', {
          localId: data.localId || '',
          serverId: order.id,
          replayed: isReplay,
        });

        logger.info(`📋 Order ${order.orderNumber} broadcast to ${tenantRoom}`);
      } catch (error: any) {
        logger.error('Order creation via socket failed:', error);
        socket.emit('error', {
          message: error?.message || 'Failed to create order',
          code: error?.code || 'ORDER_CREATE_FAILED',
        });
      }
    });

    // ─── Order Status Updates ───────────────
    socket.on('order:update_status', async (data: { orderId: string; status: string }) => {
      try {
        const order = await orderService.updateStatus(socket.tenantId!, data.orderId, data.status);
        io.to(tenantRoom).emit('order:updated', { order });
      } catch (error) {
        logger.error('Order status update failed:', error);
      }
    });

    // ─── Item Status (Kitchen → Ready) ──────
    socket.on('order:item_status', async (data: { orderId: string; itemId: string; status: string }) => {
      try {
        await orderService.updateItemStatus(socket.tenantId!, data.orderId, data.itemId, data.status);
        io.to(tenantRoom).emit('order:item_updated', data);

        if (data.status === 'READY') {
          io.to(tenantRoom).emit('kitchen:item_ready', {
            itemId: data.itemId,
            orderId: data.orderId,
          });
        }
      } catch (error) {
        logger.error('Item status update failed:', error);
      }
    });

    // ─── Table Status Updates ───────────────
    socket.on('table:update_status', async (data: { tableId: string; status: string }) => {
      io.to(tenantRoom).emit('table:status_changed', data);
    });

    // ─── Offline Sync ───────────────────────
    socket.on('sync:offline_orders', async (data: { orders: any[] }) => {
      logger.info(`📦 Syncing ${data.orders.length} offline orders from ${socket.userId}`);

      for (const offlineOrder of data.orders) {
        try {
          const idempotencyKey = parseOrderIdempotencyKey(offlineOrder.localId);
          const result = await orderService.create(
            socket.tenantId!,
            socket.userId!,
            offlineOrder.payload,
            { idempotencyKey },
          );
          const { order, isReplay } = result;

          socket.emit('sync:confirmed', {
            localId: offlineOrder.localId,
            serverId: order.id,
            replayed: isReplay,
          });

          if (!isReplay) {
            io.to(tenantRoom).emit('order:new', { order });
            await processCreatedOrder(
              socket.tenantId!,
              order,
              io,
              tenantRoom,
              offlineOrder.payload?.printToKitchen !== false,
            );
          }
        } catch (error: any) {
          logger.error(`Failed to sync offline order ${offlineOrder.localId}:`, error);
          socket.emit('sync:failed', {
            localId: offlineOrder.localId || '',
            message: error?.message || 'Failed to sync offline order',
            code: error?.code || 'ORDER_SYNC_FAILED',
          });
        }
      }
    });

    // ─── Print Result (from Print Agent) ────
    socket.on('print:result' as any, async (data: {
      jobId: string;
      attemptNumber?: number;
      dispatchToken?: string;
      success: boolean;
      error?: string;
    }) => {
      if (
        socket.role !== 'PRINT_AGENT'
        || !data
        || typeof data.jobId !== 'string'
        || data.jobId.length > 200
        || typeof data.success !== 'boolean'
        || (data.error !== undefined && typeof data.error !== 'string')
      ) {
        logger.warn(`Rejected invalid print result from socket ${socket.id}`);
        return;
      }
      const hasLeaseProof = Number.isSafeInteger(data.attemptNumber)
        && typeof data.dispatchToken === 'string'
        && data.dispatchToken.length >= 16
        && data.dispatchToken.length <= 64;
      const outcome = hasLeaseProof
        ? await acknowledgePrintJob(
            socket.tenantId!,
            data.jobId,
            data.attemptNumber!,
            data.dispatchToken!,
            data.success,
            data.error,
          )
        : await acknowledgePrintJob(socket.tenantId!, data.jobId, -1, '', data.success, data.error);
      if (outcome === 'IGNORED') {
        logger.warn(`Ignored stale/invalid print ACK for ${data.jobId}`);
        return;
      }
      if (outcome !== 'NOT_FOUND' && !hasLeaseProof) {
        logger.warn(`Rejected legacy ACK without lease proof for outbox job ${data.jobId}`);
        return;
      }
      if (data.success) {
        logger.info(`🖨️  Print job ${data.jobId} completed`);
      } else {
        logger.error(`🖨️  Print job ${data.jobId} failed:`, data.error);
      }
      // Legacy jobs that predate the outbox still complete their in-process waiter.
      printService.printJobEmitter.emit(`result:${data.jobId}`, data);
    });

    // ─── Payment Result (from Print Agent) ──
    socket.on('payment:result' as any, (data: { paymentId: string; success: boolean; message?: string }) => {
      if (socket.role !== 'PRINT_AGENT') {
        logger.warn(`Rejected payment result from non-agent socket ${socket.id}`);
        return;
      }
      logger.info(`💳 Payment result: ${data.paymentId} | Success: ${data.success}`);
      io.to(tenantRoom).emit('payment:completed', data);
    });

    // ─── Disconnection ──────────────────────
    socket.on('disconnect', (reason) => {
      logger.info(`🔌 Socket disconnected: ${socket.userId} (${reason})`);
    });
  });

  logger.success('⚡ Socket.io server initialized');
  return io;
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}
