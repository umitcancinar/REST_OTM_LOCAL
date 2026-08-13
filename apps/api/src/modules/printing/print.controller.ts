// ==========================================
// Print Controller
// ==========================================

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { getTenantId } from '../../middlewares/tenant.middleware';
import { printService } from './print.service';
import { apiResponse, paginatedResponse } from '../../utils/apiResponse';
import {
  parsePrintJobId,
  parsePrintJobListQuery,
  resolveReprintCommandId,
} from './print-outbox.policy';
import { discoverLocalPrinters } from './printer-discovery';

export const printController = {
  async discoverPrinters(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await discoverLocalPrinters();
      apiResponse({ res, data: result, message: 'Yerel yazıcı taraması tamamlandı' });
    } catch (error) { next(error); }
  },

  async getPrinters(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const printers = await printService.getPrinters(getTenantId(req));
      apiResponse({ res, data: printers });
    } catch (error) { next(error); }
  },

  async getStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const status = await printService.getStatus(getTenantId(req));
      apiResponse({ res, data: status });
    } catch (error) { next(error); }
  },

  async getJobs(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const query = parsePrintJobListQuery(req.query);
      const result = await printService.listPrintJobs(getTenantId(req), query);
      paginatedResponse(res, result.jobs, result.total, result.page, result.limit);
    } catch (error) { next(error); }
  },

  async getJob(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const job = await printService.getPrintJob(
        getTenantId(req),
        parsePrintJobId(req.params.id),
      );
      apiResponse({ res, data: job });
    } catch (error) { next(error); }
  },

  async getOperationsSummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const summary = await printService.getOperationsSummary(getTenantId(req));
      apiResponse({ res, data: summary });
    } catch (error) { next(error); }
  },

  async reprintJob(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await printService.reprintJob(
        getTenantId(req),
        parsePrintJobId(req.params.id),
        resolveReprintCommandId(req.get('Idempotency-Key'), req.body),
      );
      apiResponse({
        res,
        statusCode: 202,
        data: result,
        message: 'Yeniden baskı işi kabul edildi',
      });
    } catch (error) { next(error); }
  },

  async testPrinter(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await printService.testPrinter(getTenantId(req), req.params.id as string);
      apiResponse({ res, data: result, message: 'Test fişi başarıyla yazdırıldı' });
    } catch (error) { next(error); }
  },

  async calibratePrinter(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await printService.calibratePrinter(getTenantId(req), req.params.id as string);
      apiResponse({ res, data: result, message: 'Kalibrasyon fişi yazdırıldı' });
    } catch (error) { next(error); }
  },

  async printZReport(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const today = new Date().toISOString().split('T')[0] as string;
      const startDate = (req.body?.startDate as string) || today;
      const endDate = (req.body?.endDate as string) || startDate;
      const result = await printService.printZReport(
        getTenantId(req),
        startDate,
        endDate,
        req.body?.rangeLabel as string | undefined,
      );
      apiResponse({ res, data: result, message: 'Z raporu yazdırıldı' });
    } catch (error) { next(error); }
  },

  async createPrinter(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const printer = await printService.createPrinter(getTenantId(req), req.body);
      apiResponse({ res, statusCode: 201, data: printer, message: 'Printer created' });
    } catch (error) { next(error); }
  },

  async updatePrinter(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const printer = await printService.updatePrinter(getTenantId(req), req.params.id as string, req.body);
      apiResponse({ res, data: printer, message: 'Printer updated' });
    } catch (error) { next(error); }
  },

  async deletePrinter(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await printService.deletePrinter(getTenantId(req), req.params.id as string);
      apiResponse({ res, message: 'Printer deleted' });
    } catch (error) { next(error); }
  },

  /** POST /printers/print-bill — Adisyon yazdır (altyapı hazır) */
  async printBill(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { orderId } = req.body;
      if (!orderId) return apiResponse({ res, statusCode: 400, message: 'orderId gerekli' });
      const result = await printService.printBill(getTenantId(req), orderId);
      apiResponse({ res, data: result, message: 'Adisyon yazdırma komutu gönderildi' });
    } catch (error) { next(error); }
  },

  /** POST /printers/print-paket — Paket sipariş yazdır */
  async printPaket(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { orderId, printerId, paymentMethod } = req.body;
      if (!orderId) return apiResponse({ res, statusCode: 400, message: 'orderId gerekli' });
      const result = await printService.printPaket(getTenantId(req), orderId, printerId, paymentMethod);
      apiResponse({ res, data: result, message: '📦 Paket sipariş yazıcısına gönderildi' });
    } catch (error) { next(error); }
  },

  /** POST /printers/print-kitchen — Fırın yazıcısına (192.168.1.203) gönder */
  async printKitchen(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { orderId } = req.body;
      if (!orderId) return apiResponse({ res, statusCode: 400, message: 'orderId gerekli' });
      const result = await printService.printKitchen(getTenantId(req), orderId);
      apiResponse({ res, data: result, message: '🍞 Fırın yazıcısına gönderildi' });
    } catch (error) { next(error); }
  },

  /** POST /printers/print-grill — Izgara yazıcısına (192.168.1.202) gönder */
  async printGrill(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { orderId } = req.body;
      console.log(`[API] 🖨️ printGrill called for orderId: ${orderId}`);
      if (!orderId) return apiResponse({ res, statusCode: 400, message: 'orderId gerekli' });
      const result = await printService.printGrill(getTenantId(req), orderId);
      apiResponse({ res, data: result, message: '🔥 Izgara yazıcısına gönderildi' });
    } catch (error) { next(error); }
  },

  /** POST /printers/print-stations — ürünleri bölüme göre otomatik ayır */
  async printProductionStations(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { orderId } = req.body;
      if (!orderId) return apiResponse({ res, statusCode: 400, message: 'orderId gerekli' });
      const result = await printService.printProductionStations(getTenantId(req), orderId);
      apiResponse({ res, data: result, message: 'Mutfak fişleri ilgili istasyonlara gönderildi' });
    } catch (error) { next(error); }
  },
};
