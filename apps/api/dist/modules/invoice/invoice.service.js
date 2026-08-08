"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invoiceService = void 0;
const database_1 = require("../../config/database");
const logger_1 = require("../../utils/logger");
const crypto_1 = require("crypto");
exports.invoiceService = {
    /**
     * Generates an E-Archive Invoice for the completed order using Uyumsoft (Mocked)
     */
    async createInvoice(orderId, tenantId) {
        try {
            // 1. Fetch the complete order details
            const order = await database_1.prisma.order.findUnique({
                where: { id: orderId, tenantId },
                include: {
                    customer: true,
                    subChecks: {
                        include: {
                            items: true
                        }
                    }
                }
            });
            if (!order) {
                throw new Error('Order not found');
            }
            // Check if invoice already exists
            const existingInvoice = await database_1.prisma.invoice.findUnique({
                where: { orderId }
            });
            if (existingInvoice) {
                return existingInvoice;
            }
            // 2. Prepare Data for Integrator (Uyumsoft format logic)
            const allItems = order.subChecks.flatMap(sc => sc.items).filter(i => i.status !== 'CANCELLED');
            const invoiceData = {
                tenantId,
                orderId,
                customerInfo: order.customer ? {
                    name: order.customer.companyName || order.customer.name,
                    taxOffice: order.customer.taxOffice || 'N/A',
                    taxId: order.customer.taxId || '11111111111', // Default for individuals
                    email: order.customer.email,
                } : {
                    name: 'Nihai Tüketici',
                    taxOffice: 'Yok',
                    taxId: '11111111111',
                },
                items: allItems.map(item => ({
                    name: item.menuItemName,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    taxRate: item.taxRate, // 0, 1, 10, 20
                    totalPrice: item.totalPrice
                })),
                grandTotal: order.grandTotal,
            };
            logger_1.logger.info(`[Uyumsoft Entegrasyonu] Fatura verisi hazırlandı: Sipariş Numarası ${order.orderNumber}`);
            // 3. Mock Uyumsoft API Call
            // In a real scenario, this is where we send an XML/JSON payload to Uyumsoft via SOAP or REST.
            const integratorResult = await mockUyumsoftApiCall(invoiceData);
            // 4. Save Invoice to Database
            const invoice = await database_1.prisma.invoice.create({
                data: {
                    tenantId,
                    orderId,
                    uuid: integratorResult.uuid, // ETTN
                    invoiceNo: integratorResult.invoiceNo,
                    status: integratorResult.success ? 'SENT' : 'FAILED',
                    pdfUrl: integratorResult.pdfUrl,
                    totalAmount: order.grandTotal,
                    taxAmount: invoiceData.items.reduce((sum, item) => sum + (item.totalPrice * (item.taxRate / 100)), 0),
                    errorMessage: integratorResult.success ? null : 'Integrator connection failed'
                }
            });
            // 5. Emit to Print Agent if successful
            if (invoice.status === 'SENT') {
                const { getIO } = require('../../websocket/socket.server');
                const io = getIO();
                io.to(`tenant_${tenantId}`).emit('print:invoice', {
                    orderNumber: order.orderNumber,
                    uuid: invoice.uuid,
                    invoiceNo: invoice.invoiceNo,
                    totalAmount: invoice.totalAmount,
                    customerName: invoiceData.customerInfo.name,
                    pdfUrl: invoice.pdfUrl
                });
                logger_1.logger.info(`[Print Agent] print:invoice eventi gönderildi (ETTN: ${invoice.uuid})`);
            }
            return invoice;
        }
        catch (error) {
            logger_1.logger.error('Fatura oluşturulurken hata:', error);
            throw error;
        }
    }
};
/**
 * Simulates a request to Uyumsoft's E-Archive API
 */
async function mockUyumsoftApiCall(data) {
    return new Promise((resolve) => {
        setTimeout(() => {
            const isSuccess = true;
            const ettn = (0, crypto_1.randomUUID)();
            const invoiceNo = `UYM2026${Math.floor(100000000 + Math.random() * 900000000)}`;
            logger_1.logger.info(`[Uyumsoft] Başarılı! ETTN: ${ettn}, Fatura No: ${invoiceNo}`);
            resolve({
                success: isSuccess,
                uuid: ettn,
                invoiceNo: invoiceNo,
                pdfUrl: `https://mock-efatura.uyumsoft.com/view?ettn=${ettn}`
            });
        }, 1500); // Simulate network latency
    });
}
//# sourceMappingURL=invoice.service.js.map