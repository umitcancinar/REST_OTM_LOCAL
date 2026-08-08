"use strict";
// ==========================================
// Order Controller
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderController = void 0;
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const order_service_1 = require("./order.service");
const order_post_create_1 = require("./order.post-create");
const apiResponse_1 = require("../../utils/apiResponse");
const order_validation_1 = require("./order.validation");
exports.orderController = {
    async getAll(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const filters = {
                status: req.query.status,
                tableId: req.query.tableId,
                waiterId: req.query.waiterId,
                type: req.query.type,
                isDeleted: req.query.isDeleted === 'true' ? true : req.query.isDeleted === 'false' ? false : undefined,
                date: req.query.date,
            };
            const orders = await order_service_1.orderService.findAll(tenantId, filters);
            (0, apiResponse_1.apiResponse)({ res, data: orders });
        }
        catch (error) {
            next(error);
        }
    },
    async getById(req, res, next) {
        try {
            const order = await order_service_1.orderService.findById((0, tenant_middleware_1.getTenantId)(req), req.params.id);
            if (!order) {
                (0, apiResponse_1.apiError)(res, 404, 'Order not found');
                return;
            }
            (0, apiResponse_1.apiResponse)({ res, data: order });
        }
        catch (error) {
            next(error);
        }
    },
    async getActiveOrderByTable(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const { tableId } = req.params;
            const orders = await order_service_1.orderService.findAll(tenantId, { tableId: tableId });
            // Find the first order that is NOT completed or cancelled
            const activeOrder = orders.find((o) => !['COMPLETED', 'CANCELLED'].includes(o.status));
            (0, apiResponse_1.apiResponse)({ res, data: activeOrder || null });
        }
        catch (error) {
            next(error);
        }
    },
    async create(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const validatedData = order_validation_1.createOrderSchema.parse(req.body);
            const order = await order_service_1.orderService.create(tenantId, req.user.userId, validatedData);
            const { getIO } = require('../../websocket/socket.server');
            const io = getIO();
            io.to(`tenant:${tenantId}`).emit('order:new', order);
            io.to(`tenant:${tenantId}`).emit('table:status_changed', { tableId: order.tableId });
            await (0, order_post_create_1.processCreatedOrder)(tenantId, order, io, `tenant:${tenantId}`, validatedData.printToKitchen);
            (0, apiResponse_1.apiResponse)({ res, statusCode: 201, data: order, message: 'Order created' });
        }
        catch (error) {
            const message = error.message || 'Sipariş oluşturulamadı';
            (0, apiResponse_1.apiError)(res, error.statusCode || 500, message);
        }
    },
    async bulkDelete(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const isDeletedOnly = req.query.isDeleted === 'true';
            await order_service_1.orderService.deleteAll(tenantId, isDeletedOnly);
            const { getIO } = require('../../websocket/socket.server');
            const io = getIO();
            io.to(`tenant:${tenantId}`).emit('order:updated');
            io.to(`tenant:${tenantId}`).emit('table:status_changed');
            (0, apiResponse_1.apiResponse)({ res, message: 'All orders deleted' });
        }
        catch (error) {
            (0, apiResponse_1.apiError)(res, error.statusCode || 500, error.message || 'Siparişler temizlenemedi');
        }
    },
    async delete(req, res, next) {
        try {
            await order_service_1.orderService.delete((0, tenant_middleware_1.getTenantId)(req), req.params.id);
            const { getIO } = require('../../websocket/socket.server');
            const io = getIO();
            io.to(`tenant:${(0, tenant_middleware_1.getTenantId)(req)}`).emit('order:updated', { id: req.params.id });
            io.to(`tenant:${(0, tenant_middleware_1.getTenantId)(req)}`).emit('table:status_changed');
            (0, apiResponse_1.apiResponse)({ res, message: 'Order deleted' });
        }
        catch (error) {
            const message = error.message || 'Sipariş silinemedi';
            (0, apiResponse_1.apiError)(res, error.statusCode || 500, message);
        }
    },
    async printBill(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const orderId = req.params.id;
            const { printService } = require('../printing/print.service');
            const result = await printService.printBill(tenantId, orderId);
            (0, apiResponse_1.apiResponse)({ res, data: result, message: 'Adisyon yazıcıya gönderildi' });
        }
        catch (error) {
            const message = error.message || 'Yazdırma hatası';
            (0, apiResponse_1.apiError)(res, error.statusCode || 500, message);
        }
    },
    async updateStatus(req, res, next) {
        try {
            const { status, paymentMethod, amount } = order_validation_1.updateOrderStatusSchema.parse(req.body);
            const order = await order_service_1.orderService.updateStatus((0, tenant_middleware_1.getTenantId)(req), req.params.id, status, paymentMethod, amount);
            // E-Invoice Generation Hook
            if (status === 'COMPLETED') {
                try {
                    const { invoiceService } = require('../invoice/invoice.service');
                    // Async generate invoice to not block the request
                    invoiceService.createInvoice(order.id, (0, tenant_middleware_1.getTenantId)(req)).catch((err) => {
                        console.error('Invoice generation failed:', err);
                    });
                }
                catch (invoiceErr) {
                    console.error('Could not load invoice service', invoiceErr);
                }
            }
            const { getIO } = require('../../websocket/socket.server');
            const io = getIO();
            const tId = (0, tenant_middleware_1.getTenantId)(req);
            io.to(`tenant:${tId}`).emit('order:updated', order);
            io.to(`tenant:${tId}`).emit('table:status_changed', { tableId: order.tableId });
            (0, apiResponse_1.apiResponse)({ res, data: order, message: 'Order status updated' });
        }
        catch (error) {
            const message = error.message || 'Sipariş durumu güncellenemedi';
            (0, apiResponse_1.apiError)(res, error.statusCode || 500, message);
        }
    },
    async hideOrder(req, res, next) {
        try {
            const order = await order_service_1.orderService.toggleHide((0, tenant_middleware_1.getTenantId)(req), req.params.id);
            const { getIO } = require('../../websocket/socket.server');
            const io = getIO();
            const tId = (0, tenant_middleware_1.getTenantId)(req);
            io.to(`tenant:${tId}`).emit('order:updated', order);
            (0, apiResponse_1.apiResponse)({ res, data: order, message: 'Order visibility toggled' });
        }
        catch (error) {
            const message = error.message || 'Sipariş gizlenemedi';
            (0, apiResponse_1.apiError)(res, error.statusCode || 500, message);
        }
    },
    async updateItemStatus(req, res, next) {
        try {
            const { status, notes } = order_validation_1.updateItemStatusSchema.parse(req.body);
            const item = await order_service_1.orderService.updateItemStatus((0, tenant_middleware_1.getTenantId)(req), req.params.orderId, req.params.itemId, status, notes);
            const { getIO } = require('../../websocket/socket.server');
            const io = getIO();
            io.to(`tenant:${(0, tenant_middleware_1.getTenantId)(req)}`).emit('order:updated', { id: req.params.orderId });
            (0, apiResponse_1.apiResponse)({ res, data: item, message: 'Item status updated' });
        }
        catch (error) {
            const message = error.message || 'Ürün durumu güncellenemedi';
            (0, apiResponse_1.apiError)(res, error.statusCode || 500, message);
        }
    },
    async updateItemQuantity(req, res, next) {
        try {
            const { quantity } = order_validation_1.updateItemQuantitySchema.parse(req.body);
            const item = await order_service_1.orderService.updateItemQuantity((0, tenant_middleware_1.getTenantId)(req), req.params.orderId, req.params.itemId, quantity);
            const { getIO } = require('../../websocket/socket.server');
            const io = getIO();
            io.to(`tenant:${(0, tenant_middleware_1.getTenantId)(req)}`).emit('order:updated', { id: req.params.orderId });
            (0, apiResponse_1.apiResponse)({ res, data: item, message: 'Item quantity updated' });
        }
        catch (error) {
            const message = error.message || 'Ürün miktarı güncellenemedi';
            (0, apiResponse_1.apiError)(res, error.statusCode || 500, message);
        }
    },
    async transferTable(req, res, next) {
        try {
            const { newTableId } = order_validation_1.transferTableSchema.parse(req.body);
            const updatedOrder = await order_service_1.orderService.transferTable((0, tenant_middleware_1.getTenantId)(req), req.params.id, newTableId);
            const { getIO } = require('../../websocket/socket.server');
            const io = getIO();
            const tId = (0, tenant_middleware_1.getTenantId)(req);
            io.to(`tenant:${tId}`).emit('order:updated', updatedOrder);
            io.to(`tenant:${tId}`).emit('table:status_changed');
            (0, apiResponse_1.apiResponse)({ res, data: updatedOrder, message: 'Masa başarıyla taşındı' });
        }
        catch (error) {
            const message = error.message || 'Masa taşıma başarısız';
            (0, apiResponse_1.apiError)(res, error.statusCode || 500, message);
        }
    },
};
//# sourceMappingURL=order.controller.js.map