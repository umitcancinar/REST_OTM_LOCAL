"use strict";
// ==========================================
// Print Controller
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.printController = void 0;
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const print_service_1 = require("./print.service");
const apiResponse_1 = require("../../utils/apiResponse");
exports.printController = {
    async getPrinters(req, res, next) {
        try {
            const printers = await print_service_1.printService.getPrinters((0, tenant_middleware_1.getTenantId)(req));
            (0, apiResponse_1.apiResponse)({ res, data: printers });
        }
        catch (error) {
            next(error);
        }
    },
    async getStatus(req, res, next) {
        try {
            const status = await print_service_1.printService.getStatus((0, tenant_middleware_1.getTenantId)(req));
            (0, apiResponse_1.apiResponse)({ res, data: status });
        }
        catch (error) {
            next(error);
        }
    },
    async testPrinter(req, res, next) {
        try {
            const result = await print_service_1.printService.testPrinter((0, tenant_middleware_1.getTenantId)(req), req.params.id);
            (0, apiResponse_1.apiResponse)({ res, data: result, message: 'Test fişi başarıyla yazdırıldı' });
        }
        catch (error) {
            next(error);
        }
    },
    async calibratePrinter(req, res, next) {
        try {
            const result = await print_service_1.printService.calibratePrinter((0, tenant_middleware_1.getTenantId)(req), req.params.id);
            (0, apiResponse_1.apiResponse)({ res, data: result, message: 'Kalibrasyon fişi yazdırıldı' });
        }
        catch (error) {
            next(error);
        }
    },
    async printZReport(req, res, next) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const startDate = req.body?.startDate || today;
            const endDate = req.body?.endDate || startDate;
            const result = await print_service_1.printService.printZReport((0, tenant_middleware_1.getTenantId)(req), startDate, endDate, req.body?.rangeLabel);
            (0, apiResponse_1.apiResponse)({ res, data: result, message: 'Z raporu yazdırıldı' });
        }
        catch (error) {
            next(error);
        }
    },
    async createPrinter(req, res, next) {
        try {
            const printer = await print_service_1.printService.createPrinter((0, tenant_middleware_1.getTenantId)(req), req.body);
            (0, apiResponse_1.apiResponse)({ res, statusCode: 201, data: printer, message: 'Printer created' });
        }
        catch (error) {
            next(error);
        }
    },
    async updatePrinter(req, res, next) {
        try {
            const printer = await print_service_1.printService.updatePrinter((0, tenant_middleware_1.getTenantId)(req), req.params.id, req.body);
            (0, apiResponse_1.apiResponse)({ res, data: printer, message: 'Printer updated' });
        }
        catch (error) {
            next(error);
        }
    },
    async deletePrinter(req, res, next) {
        try {
            await print_service_1.printService.deletePrinter((0, tenant_middleware_1.getTenantId)(req), req.params.id);
            (0, apiResponse_1.apiResponse)({ res, message: 'Printer deleted' });
        }
        catch (error) {
            next(error);
        }
    },
    /** POST /printers/print-bill — Adisyon yazdır (altyapı hazır) */
    async printBill(req, res, next) {
        try {
            const { orderId } = req.body;
            if (!orderId)
                return (0, apiResponse_1.apiResponse)({ res, statusCode: 400, message: 'orderId gerekli' });
            const result = await print_service_1.printService.printBill((0, tenant_middleware_1.getTenantId)(req), orderId);
            (0, apiResponse_1.apiResponse)({ res, data: result, message: 'Adisyon yazdırma komutu gönderildi' });
        }
        catch (error) {
            next(error);
        }
    },
    /** POST /printers/print-paket — Paket sipariş yazdır */
    async printPaket(req, res, next) {
        try {
            const { orderId, printerId, paymentMethod } = req.body;
            if (!orderId)
                return (0, apiResponse_1.apiResponse)({ res, statusCode: 400, message: 'orderId gerekli' });
            const result = await print_service_1.printService.printPaket((0, tenant_middleware_1.getTenantId)(req), orderId, printerId, paymentMethod);
            (0, apiResponse_1.apiResponse)({ res, data: result, message: '📦 Paket sipariş yazıcısına gönderildi' });
        }
        catch (error) {
            next(error);
        }
    },
    /** POST /printers/print-kitchen — Fırın yazıcısına (192.168.1.203) gönder */
    async printKitchen(req, res, next) {
        try {
            const { orderId } = req.body;
            if (!orderId)
                return (0, apiResponse_1.apiResponse)({ res, statusCode: 400, message: 'orderId gerekli' });
            const result = await print_service_1.printService.printKitchen((0, tenant_middleware_1.getTenantId)(req), orderId);
            (0, apiResponse_1.apiResponse)({ res, data: result, message: '🍞 Fırın yazıcısına gönderildi' });
        }
        catch (error) {
            next(error);
        }
    },
    /** POST /printers/print-grill — Izgara yazıcısına (192.168.1.202) gönder */
    async printGrill(req, res, next) {
        try {
            const { orderId } = req.body;
            console.log(`[API] 🖨️ printGrill called for orderId: ${orderId}`);
            if (!orderId)
                return (0, apiResponse_1.apiResponse)({ res, statusCode: 400, message: 'orderId gerekli' });
            const result = await print_service_1.printService.printGrill((0, tenant_middleware_1.getTenantId)(req), orderId);
            (0, apiResponse_1.apiResponse)({ res, data: result, message: '🔥 Izgara yazıcısına gönderildi' });
        }
        catch (error) {
            next(error);
        }
    },
    /** POST /printers/print-stations — ürünleri bölüme göre otomatik ayır */
    async printProductionStations(req, res, next) {
        try {
            const { orderId } = req.body;
            if (!orderId)
                return (0, apiResponse_1.apiResponse)({ res, statusCode: 400, message: 'orderId gerekli' });
            const result = await print_service_1.printService.printProductionStations((0, tenant_middleware_1.getTenantId)(req), orderId);
            (0, apiResponse_1.apiResponse)({ res, data: result, message: 'Mutfak fişleri ilgili istasyonlara gönderildi' });
        }
        catch (error) {
            next(error);
        }
    },
};
//# sourceMappingURL=print.controller.js.map