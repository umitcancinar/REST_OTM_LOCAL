// ==========================================
// Order Controller
// ==========================================

import { Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { getTenantId } from '../../middlewares/tenant.middleware';
import { orderService } from './order.service';
import { processCreatedOrder } from './order.post-create';
import { apiResponse, apiError } from '../../utils/apiResponse';
import { createOrderSchema, updateOrderStatusSchema, updateItemStatusSchema, transferTableSchema, updateItemQuantitySchema } from './order.validation';
import { resolveHttpOrderIdempotencyKey } from './order-idempotency.policy';

export const orderController = {
  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const filters = {
        status: req.query.status as string | undefined,
        tableId: req.query.tableId as string | undefined,
        waiterId: req.query.waiterId as string | undefined,
        type: req.query.type as string | undefined,
        isDeleted: req.query.isDeleted === 'true' ? true : req.query.isDeleted === 'false' ? false : undefined,
        date: req.query.date as string | undefined,
      };
      const orders = await orderService.findAll(tenantId, filters);
      apiResponse({ res, data: orders });
    } catch (error) { next(error); }
  },

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const order = await orderService.findById(getTenantId(req), (req.params.id as string));
      if (!order) { apiError(res, 404, 'Order not found'); return; }
      apiResponse({ res, data: order });
    } catch (error) { next(error); }
  },

  async getActiveOrderByTable(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const { tableId } = req.params;
      const orders = await orderService.findAll(tenantId, { tableId: tableId as string });
      // Find the first order that is NOT completed or cancelled
      const activeOrder = orders.find((o: any) => !['COMPLETED', 'CANCELLED'].includes(o.status));
      apiResponse({ res, data: activeOrder || null });
    } catch (error) { next(error); }
  },

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const validatedData = createOrderSchema.parse(req.body);
      const idempotencyKey = resolveHttpOrderIdempotencyKey(
        req.get('Idempotency-Key'),
        validatedData.clientCommandId,
      );
      const { clientCommandId: _clientCommandId, ...orderInput } = validatedData;
      const result = await orderService.create(
        tenantId,
        req.user!.userId,
        orderInput,
        { idempotencyKey },
      );
      const { order, isReplay } = result;

      if (!isReplay) {
        const { getIO } = require('../../websocket/socket.server');
        const io = getIO();
        io.to(`tenant:${tenantId}`).emit('order:new', order);
        io.to(`tenant:${tenantId}`).emit('table:status_changed', { tableId: order.tableId });
        await processCreatedOrder(
          tenantId,
          order,
          io,
          `tenant:${tenantId}`,
          validatedData.printToKitchen,
        );
      }

      if (idempotencyKey) res.setHeader('Idempotency-Replayed', String(isReplay));
      apiResponse({
        res,
        statusCode: isReplay ? 200 : 201,
        data: order,
        message: isReplay ? 'Order replayed' : 'Order created',
      });
    } catch (error: any) { 
      const message = error.message || 'Sipariş oluşturulamadı';
      apiError(res, error instanceof ZodError ? 400 : (error.statusCode || 500), message);
    }
  },

  async bulkDelete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const isDeletedOnly = req.query.isDeleted === 'true';
      await orderService.deleteAll(tenantId, isDeletedOnly);
      
      const { getIO } = require('../../websocket/socket.server');
      const io = getIO();
      io.to(`tenant:${tenantId}`).emit('order:updated');
      io.to(`tenant:${tenantId}`).emit('table:status_changed');

      apiResponse({ res, message: 'All orders deleted' });
    } catch (error: any) { 
      apiError(res, error.statusCode || 500, error.message || 'Siparişler temizlenemedi');
    }
  },

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await orderService.delete(getTenantId(req), (req.params.id as string));
      
      const { getIO } = require('../../websocket/socket.server');
      const io = getIO();
      io.to(`tenant:${getTenantId(req)}`).emit('order:updated', { id: req.params.id });
      io.to(`tenant:${getTenantId(req)}`).emit('table:status_changed');

      apiResponse({ res, message: 'Order deleted' });
    } catch (error: any) { 
      const message = error.message || 'Sipariş silinemedi';
      apiError(res, error.statusCode || 500, message);
    }
  },

  async printBill(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const orderId = (req.params.id as string);
      const { printService } = require('../printing/print.service');
      const result = await printService.printBill(tenantId, orderId);
      apiResponse({ res, data: result, message: 'Adisyon yazıcıya gönderildi' });
    } catch (error: any) { 
      const message = error.message || 'Yazdırma hatası';
      apiError(res, error.statusCode || 500, message);
    }
  },

  async updateStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { status, paymentMethod, amount } = updateOrderStatusSchema.parse(req.body);
      const order = await orderService.updateStatus(getTenantId(req), (req.params.id as string), status, paymentMethod, amount);
      
      // E-Invoice Generation Hook
      if (status === 'COMPLETED') {
        try {
          const { invoiceService } = require('../invoice/invoice.service');
          // Async generate invoice to not block the request
          invoiceService.createInvoice(order.id, getTenantId(req)).catch((err: any) => {
            console.error('Invoice generation failed:', err);
          });
        } catch (invoiceErr) {
          console.error('Could not load invoice service', invoiceErr);
        }
      }

      const { getIO } = require('../../websocket/socket.server');
      const io = getIO();
      const tId = getTenantId(req);
      io.to(`tenant:${tId}`).emit('order:updated', order);
      io.to(`tenant:${tId}`).emit('table:status_changed', { tableId: order.tableId });

      apiResponse({ res, data: order, message: 'Order status updated' });
    } catch (error: any) { 
      const message = error.message || 'Sipariş durumu güncellenemedi';
      apiError(res, error.statusCode || 500, message);
    }
  },

  async hideOrder(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const order = await orderService.toggleHide(getTenantId(req), (req.params.id as string));
      
      const { getIO } = require('../../websocket/socket.server');
      const io = getIO();
      const tId = getTenantId(req);
      io.to(`tenant:${tId}`).emit('order:updated', order);

      apiResponse({ res, data: order, message: 'Order visibility toggled' });
    } catch (error: any) { 
      const message = error.message || 'Sipariş gizlenemedi';
      apiError(res, error.statusCode || 500, message);
    }
  },

  async updateItemStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { status, notes } = updateItemStatusSchema.parse(req.body);
      const item = await orderService.updateItemStatus(
        getTenantId(req),
        req.params.orderId as string,
        req.params.itemId as string,
        status,
        notes
      );

      const { getIO } = require('../../websocket/socket.server');
      const io = getIO();
      io.to(`tenant:${getTenantId(req)}`).emit('order:updated', { id: req.params.orderId });

      apiResponse({ res, data: item, message: 'Item status updated' });
    } catch (error: any) { 
      const message = error.message || 'Ürün durumu güncellenemedi';
      apiError(res, error.statusCode || 500, message);
    }
  },

  async updateItemQuantity(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { quantity } = updateItemQuantitySchema.parse(req.body);
      const item = await orderService.updateItemQuantity(
        getTenantId(req),
        req.params.orderId as string,
        req.params.itemId as string,
        quantity
      );

      const { getIO } = require('../../websocket/socket.server');
      const io = getIO();
      io.to(`tenant:${getTenantId(req)}`).emit('order:updated', { id: req.params.orderId });

      apiResponse({ res, data: item, message: 'Item quantity updated' });
    } catch (error: any) { 
      const message = error.message || 'Ürün miktarı güncellenemedi';
      apiError(res, error.statusCode || 500, message);
    }
  },

  async transferTable(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { newTableId } = transferTableSchema.parse(req.body);
      const updatedOrder = await orderService.transferTable(
        getTenantId(req),
        (req.params.id as string),
        newTableId
      );

      const { getIO } = require('../../websocket/socket.server');
      const io = getIO();
      const tId = getTenantId(req);
      io.to(`tenant:${tId}`).emit('order:updated', updatedOrder);
      io.to(`tenant:${tId}`).emit('table:status_changed');

      apiResponse({ res, data: updatedOrder, message: 'Masa başarıyla taşındı' });
    } catch (error: any) { 
      const message = error.message || 'Masa taşıma başarısız';
      apiError(res, error.statusCode || 500, message);
    }
  },
};
