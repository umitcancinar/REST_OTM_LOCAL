import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { randomUUID } from 'crypto';

export const invoiceService = {
  /**
   * Generates an E-Archive Invoice for the completed order using Uyumsoft (Mocked)
   */
  async createInvoice(orderId: string, tenantId: string) {
    try {
      // 1. Fetch the complete order details
      const order = await prisma.order.findUnique({
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
      const existingInvoice = await prisma.invoice.findUnique({
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

      logger.info(`[Uyumsoft Entegrasyonu] Fatura verisi hazırlandı: Sipariş Numarası ${order.orderNumber}`);

      // 3. Mock Uyumsoft API Call
      // In a real scenario, this is where we send an XML/JSON payload to Uyumsoft via SOAP or REST.
      const integratorResult = await mockUyumsoftApiCall(invoiceData);

      // 4. Save Invoice to Database
      const invoice = await prisma.invoice.create({
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
        logger.info(`[Print Agent] print:invoice eventi gönderildi (ETTN: ${invoice.uuid})`);
      }

      return invoice;

    } catch (error) {
      logger.error('Fatura oluşturulurken hata:', error);
      throw error;
    }
  }
};

/**
 * Simulates a request to Uyumsoft's E-Archive API
 */
async function mockUyumsoftApiCall(data: any): Promise<{success: boolean, uuid: string, invoiceNo: string, pdfUrl: string}> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const isSuccess = true; 
      const ettn = randomUUID();
      const invoiceNo = `UYM2026${Math.floor(100000000 + Math.random() * 900000000)}`;
      
      logger.info(`[Uyumsoft] Başarılı! ETTN: ${ettn}, Fatura No: ${invoiceNo}`);

      resolve({
        success: isSuccess,
        uuid: ettn,
        invoiceNo: invoiceNo,
        pdfUrl: `https://mock-efatura.uyumsoft.com/view?ettn=${ettn}`
      });
    }, 1500); // Simulate network latency
  });
}
