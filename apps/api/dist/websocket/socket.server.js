"use strict";
// ==========================================
// Socket.io Server Setup
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeSocketServer = initializeSocketServer;
exports.getIO = getIO;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = require("crypto");
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
const database_1 = __importDefault(require("../config/database"));
const order_service_1 = require("../modules/orders/order.service");
const order_post_create_1 = require("../modules/orders/order.post-create");
const print_service_1 = require("../modules/printing/print.service");
let io;
function safeCompare(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length)
        return false;
    return (0, crypto_1.timingSafeEqual)(left, right);
}
function initializeSocketServer(httpServer) {
    io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: env_1.env.CORS_ORIGIN,
            methods: ['GET', 'POST'],
            credentials: true,
        },
        pingTimeout: 60000,
        pingInterval: 25000,
    });
    // ─── Authentication Middleware ──────────
    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
        const agentType = socket.handshake.auth.agentType;
        if (!token) {
            return next(new Error('Authentication token required'));
        }
        // Special authentication for Local Print Agent
        if (agentType === 'print-agent') {
            const declaredTenantId = socket.handshake.auth.tenantId;
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
            const tenant = await database_1.default.tenant.findUnique({
                where: { id: declaredTenantId },
                select: { id: true, printAgentSecret: true },
            });
            if (!tenant) {
                return next(new Error('Unknown tenant'));
            }
            const expectedSecret = tenant.printAgentSecret || env_1.env.PRINT_AGENT_SECRET;
            // Sabit zamanli karsilastirma: zamanlama saldirisiyla sirrin
            // tahmin edilmesini zorlastirir.
            if (safeCompare(String(token), expectedSecret)) {
                socket.userId = 'print-agent';
                socket.role = 'PRINT_AGENT';
                socket.tenantId = declaredTenantId;
                return next();
            }
            else {
                return next(new Error('Invalid print agent secret'));
            }
        }
        // Standard JWT authentication for Web Clients
        try {
            const decoded = jsonwebtoken_1.default.verify(token, env_1.env.JWT_ACCESS_SECRET);
            socket.userId = decoded.userId;
            socket.tenantId = decoded.tenantId;
            socket.role = decoded.role;
            next();
        }
        catch (err) {
            next(new Error('Invalid authentication token'));
        }
    });
    // ─── Connection Handler ─────────────────
    io.on('connection', (socket) => {
        const tenantRoom = `tenant:${socket.tenantId}`;
        socket.join(tenantRoom);
        if (socket.role === 'PRINT_AGENT') {
            socket.join(`${tenantRoom}:print-agents`);
        }
        logger_1.logger.info(`🔌 Socket connected: ${socket.userId} (${socket.role}) → ${tenantRoom}`);
        // ─── Order Events ───────────────────────
        socket.on('order:create', async (data) => {
            try {
                const order = await order_service_1.orderService.create(socket.tenantId, socket.userId, data.order);
                // Broadcast new order to the tenant room
                io.to(tenantRoom).emit('order:new', { order });
                await (0, order_post_create_1.processCreatedOrder)(socket.tenantId, order, io, tenantRoom, data.order?.printToKitchen !== false);
                // Acknowledge back to sender (with offline sync support)
                socket.emit('sync:confirmed', {
                    localId: data.localId || '',
                    serverId: order.id,
                });
                logger_1.logger.info(`📋 Order ${order.orderNumber} broadcast to ${tenantRoom}`);
            }
            catch (error) {
                logger_1.logger.error('Order creation via socket failed:', error);
                socket.emit('error', {
                    message: 'Failed to create order',
                    code: 'ORDER_CREATE_FAILED',
                });
            }
        });
        // ─── Order Status Updates ───────────────
        socket.on('order:update_status', async (data) => {
            try {
                const order = await order_service_1.orderService.updateStatus(socket.tenantId, data.orderId, data.status);
                io.to(tenantRoom).emit('order:updated', { order });
            }
            catch (error) {
                logger_1.logger.error('Order status update failed:', error);
            }
        });
        // ─── Item Status (Kitchen → Ready) ──────
        socket.on('order:item_status', async (data) => {
            try {
                await order_service_1.orderService.updateItemStatus(socket.tenantId, data.orderId, data.itemId, data.status);
                io.to(tenantRoom).emit('order:item_updated', data);
                if (data.status === 'READY') {
                    io.to(tenantRoom).emit('kitchen:item_ready', {
                        itemId: data.itemId,
                        orderId: data.orderId,
                    });
                }
            }
            catch (error) {
                logger_1.logger.error('Item status update failed:', error);
            }
        });
        // ─── Table Status Updates ───────────────
        socket.on('table:update_status', async (data) => {
            io.to(tenantRoom).emit('table:status_changed', data);
        });
        // ─── Offline Sync ───────────────────────
        socket.on('sync:offline_orders', async (data) => {
            logger_1.logger.info(`📦 Syncing ${data.orders.length} offline orders from ${socket.userId}`);
            for (const offlineOrder of data.orders) {
                try {
                    const order = await order_service_1.orderService.create(socket.tenantId, socket.userId, offlineOrder.payload);
                    socket.emit('sync:confirmed', {
                        localId: offlineOrder.localId,
                        serverId: order.id,
                    });
                    io.to(tenantRoom).emit('order:new', { order });
                    await (0, order_post_create_1.processCreatedOrder)(socket.tenantId, order, io, tenantRoom, offlineOrder.payload?.printToKitchen !== false);
                }
                catch (error) {
                    logger_1.logger.error(`Failed to sync offline order ${offlineOrder.localId}:`, error);
                }
            }
        });
        // ─── Print Result (from Print Agent) ────
        socket.on('print:result', (data) => {
            if (socket.role !== 'PRINT_AGENT' || !data || typeof data.jobId !== 'string' || data.jobId.length > 200) {
                logger_1.logger.warn(`Rejected invalid print result from socket ${socket.id}`);
                return;
            }
            if (data.success) {
                logger_1.logger.info(`🖨️  Print job ${data.jobId} completed`);
            }
            else {
                logger_1.logger.error(`🖨️  Print job ${data.jobId} failed:`, data.error);
            }
            print_service_1.printService.printJobEmitter.emit(`result:${data.jobId}`, data);
        });
        // ─── Payment Result (from Print Agent) ──
        socket.on('payment:result', (data) => {
            if (socket.role !== 'PRINT_AGENT') {
                logger_1.logger.warn(`Rejected payment result from non-agent socket ${socket.id}`);
                return;
            }
            logger_1.logger.info(`💳 Payment result: ${data.paymentId} | Success: ${data.success}`);
            io.to(tenantRoom).emit('payment:completed', data);
        });
        // ─── Disconnection ──────────────────────
        socket.on('disconnect', (reason) => {
            logger_1.logger.info(`🔌 Socket disconnected: ${socket.userId} (${reason})`);
        });
    });
    logger_1.logger.success('⚡ Socket.io server initialized');
    return io;
}
function getIO() {
    if (!io)
        throw new Error('Socket.io not initialized');
    return io;
}
//# sourceMappingURL=socket.server.js.map