"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.posService = void 0;
const database_1 = require("../../config/database");
const logger_1 = require("../../utils/logger");
exports.posService = {
    /**
     * Starts a POS payment transaction
     */
    async startPayment(tenantId, orderId, amount) {
        // 1. Find POS device for this tenant
        // We look for a PrinterConfig with type 'POS' or containing 'POS' in the name
        const posDevice = await database_1.prisma.printerConfig.findFirst({
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
        const { getIO } = await Promise.resolve().then(() => __importStar(require('../../websocket/socket.server')));
        const io = getIO();
        io.to(`tenant:${tenantId}`).emit('payment:start', paymentJob);
        logger_1.logger.info(`💳 POS Payment request sent: ${paymentId} → ${posDevice.name} (${posDevice.ipAddress}:${posDevice.port}) | Amount: ${amount} TL`);
        return { paymentId, posName: posDevice.name };
    }
};
//# sourceMappingURL=pos.service.js.map