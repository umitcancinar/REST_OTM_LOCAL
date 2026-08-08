// ==========================================
// Print Agent — WebSocket Client
// ==========================================
// Connects to the REST_OTM cloud server via
// WebSocket and listens for print jobs.
// Runs locally on the restaurant's network.

import { io, Socket } from 'socket.io-client';
import { RENDER_ENGINE_VERSION } from '@rest-otm/receipt-core';
import { config } from './config';
import { escpos, PrintLayout } from './printer/escpos';
import type { PrintLayoutKey } from '@rest-otm/receipt-core';
import { sendToPrinter } from './printer/router';
import { GMP3Handler } from './pos/gmp3';

let socket: Socket;
let reconnectAttempts = 0;
const MAX_RECONNECT_DISPLAY = 5;

function connect(): void {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║                                           ║
  ║   🖨️  REST_OTM Local Print Agent          ║
  ║                                           ║
  ║   Connecting to: ${config.wsUrl.padEnd(22)}║
  ║                                           ║
  ╚═══════════════════════════════════════════╝
  `);
  console.log(`🧾 Fiş render motoru: v${RENDER_ENGINE_VERSION}`);

  socket = io(config.wsUrl, {
    auth: { token: config.secret, agentType: 'print-agent', tenantId: config.tenantId },
    reconnection: true,
    reconnectionDelay: config.reconnectInterval,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    reconnectAttempts = 0;
    console.log('✅ Connected to REST_OTM server');
    console.log(`📡 Listening for print jobs...`);
  });

  // ─── Handle Kitchen (Fırın) Print Jobs ────────────────
  socket.on('print:kitchen', async (data: {
    jobId: string;
    department: 'KITCHEN' | 'GRILL';
    ipAddress?: string;
    port?: number;
    items: Array<{
      menuItemName: string;
      quantity: number;
      portionOption: string;
      notes?: string | null;
    }>;
    tableNumber: number;
    waiterName?: string;
    orderNumber: string;
    isCancel?: boolean;
    isTreat?: boolean;
    // Özel çıktı tasarım ayarları — API tarafından tenant DB'den çekilir
    layout?: PrintLayout;
  }) => {
    const dept = data.department === 'GRILL' ? 'IZGARA' : 'FIRIN';
    console.log(`\n🍳 ${dept} print job: ${data.jobId}`);
    console.log(`   Order: ${data.orderNumber} | Table: ${data.tableNumber}`);
    console.log(`   Items: ${data.items.map((item) => `${item.quantity}x ${item.menuItemName}`).join(', ')}`);
    if (data.layout?.headerText) {
      console.log(`   🎨 Layout header: ${data.layout.headerText}`);
    }

    try {
      const ticketData = await escpos.kitchenTicket({
        orderNumber: data.orderNumber,
        tableNumber: data.tableNumber,
        waiterName: data.waiterName,
        department: data.department,
        items: data.items,
        timestamp: new Date(),
        layout: data.layout, // Özel tasarım ayarlarını geçir
        isCancel: data.isCancel,
        isTreat: data.isTreat,
      });

      // Sunucunun seçtiği yazıcı kaydı tek doğruluk kaynağıdır. Böylece ayarlardaki
      // IP/port değişikliği agent yeniden başlatılmadan bütün panellerde geçerli olur.
      const ip = data.ipAddress;
      const port = data.port;

      console.log(`   📡 Sending to ${ip || 'tanımsız'}:${port || 'tanımsız'}`);
      const success = await sendToPrinter('', ticketData, ip, port);

      socket.emit('print:result', {
        jobId: data.jobId,
        success,
        error: success ? undefined : `${dept} yazıcısına bağlanılamadı (${ip}:${port})`,
      });

      console.log(success ? `   ✅ ${dept} job ${data.jobId} SENT` : `   ❌ ${dept} job ${data.jobId} FAILED`);
    } catch (error) {
      console.error(`   ❌ ${dept} print error:`, error);
      socket.emit('print:result', {
        jobId: data.jobId,
        success: false,
        error: (error as Error).message,
      });
    }
  });

  // Backward-compat: legacy print:job events (eski akış için)
  socket.on('print:job', async (data: {
    jobId: string;
    printer: string;
    department: string;
    ipAddress?: string;
    port?: number;
    items: Array<{
      menuItemName: string;
      quantity: number;
      portionOption: string;
      notes?: string | null;
    }>;
    tableNumber: number;
    orderNumber: string;
  }) => {
    console.log(`\n📋 Legacy print job: ${data.jobId} | Dept: ${data.department}`);

    try {
      const dept = (data.department === 'GRILL') ? 'GRILL' : 'KITCHEN';
      const ticketData = await escpos.kitchenTicket({
        orderNumber: data.orderNumber,
        tableNumber: data.tableNumber,
        department: dept,
        items: data.items,
        timestamp: new Date(),
      });

      const success = await sendToPrinter(data.printer, ticketData, data.ipAddress, data.port);
      socket.emit('print:result', { jobId: data.jobId, success });

      console.log(success ? `   ✅ OK` : `   ❌ FAILED`);
    } catch (error) {
      console.error(`   ❌ Error:`, error);
      socket.emit('print:result', { jobId: data.jobId, success: false, error: (error as Error).message });
    }
  });



  // ─── Handle Bill Printing ────────────────
  socket.on('print:bill', async (data: {
    jobId: string;
    printer: string;
    ipAddress?: string;
    port?: number;
    restaurantName: string;
    orderNumber: string;
    tableNumber: number;
    waiterName: string;
    customer?: { name: string; phone?: string | null; address?: string | null };
    items: Array<{ name: string; quantity: number; price: number; notes?: string }>;
    total: number;
    timestamp: string;
    layout?: PrintLayout;
    paymentMethod?: string | null;
    notes?: string | null;
  }) => {
    console.log(`\n🧾 Bill printing: ${data.jobId}`);
    
    try {
      const ticketData = await escpos.bill({
        ...data,
        timestamp: new Date(data.timestamp),
        paymentMethod: data.paymentMethod,
      });

      const success = await sendToPrinter(data.printer, ticketData, data.ipAddress, data.port);
      
      socket.emit('print:result', {
        jobId: data.jobId,
        success,
        error: success ? undefined : 'Failed to send to printer',
      });
    } catch (error) {
      console.error(`   ❌ Bill print error:`, error);
      socket.emit('print:result', {
        jobId: data.jobId,
        success: false,
        error: (error as Error).message,
      });
    }
  });

  // ─── Handle Calibration Ticket ────────────────────────
  // Uzerinde kendi beklenen olculeri yazili bir cetvel basar. Cikti
  // ekrandakiyle uyusmadiginda sebebi tahminle degil, kagidi olcerek
  // bulmak icin kullanilir.
  socket.on('print:calibration', async (data: {
    jobId: string;
    printer: string;
    ipAddress?: string;
    port?: number;
    layoutKey: PrintLayoutKey;
    layout?: PrintLayout;
  }) => {
    console.log(`\n📏 Kalibrasyon fişi: ${data.jobId} | Şablon: ${data.layoutKey}`);

    try {
      const ticketData = escpos.calibration(data.layoutKey, data.layout);
      const success = await sendToPrinter(data.printer, ticketData, data.ipAddress, data.port);
      socket.emit('print:result', {
        jobId: data.jobId,
        success,
        error: success ? undefined : 'Failed to send to printer',
      });
    } catch (error) {
      console.error(`   ❌ Kalibrasyon hatası:`, error);
      socket.emit('print:result', {
        jobId: data.jobId,
        success: false,
        error: (error as Error).message,
      });
    }
  });

  // ─── Z Raporu (gun sonu ozeti) ───
  socket.on('print:zreport', async (data: {
    jobId: string;
    printer: string;
    ipAddress?: string;
    port?: number;
    layout?: PrintLayout;
    // Rapor verisi (escpos.zReport'un bekledigi alanlar)
    [key: string]: unknown;
  }) => {
    console.log(`\n📊 Z raporu: ${data.jobId}`);

    try {
      const ticketData = escpos.zReport(data as never);
      const success = await sendToPrinter(data.printer, ticketData, data.ipAddress, data.port);
      socket.emit('print:result', {
        jobId: data.jobId,
        success,
        error: success ? undefined : 'Failed to send to printer',
      });
    } catch (error) {
      console.error(`   ❌ Z raporu hatası:`, error);
      socket.emit('print:result', {
        jobId: data.jobId,
        success: false,
        error: (error as Error).message,
      });
    }
  });

  // ─── Handle E-Archive Invoice Printing ───
  socket.on('print:invoice', async (data: {
    orderNumber: string;
    uuid: string;
    invoiceNo: string;
    totalAmount: number;
    customerName: string;
    pdfUrl?: string;
  }) => {
    console.log(`\n📄 Invoice printing: ${data.invoiceNo} (ETTN: ${data.uuid})`);
    
    try {
      const ticketData = escpos.invoiceInfo(data);

      // In a real scenario, you'd configure a specific 'INVOICE' printer.
      // For now, we fallback to the first configured cashier or network printer.
      const targetPrinter = Object.keys(config.printers).find(k => config.printers[k]?.type === 'network') || 'CashierPrinter';

      const success = await sendToPrinter(targetPrinter, ticketData);
      
      if (success) {
        console.log(`   ✅ Invoice ${data.invoiceNo} printed successfully`);
      } else {
        console.log(`   ❌ Invoice print failed for ${data.invoiceNo}`);
      }
    } catch (error) {
      console.error(`   ❌ Invoice print error:`, error);
    }
  });

  // ─── Handle POS Payments ─────────────────
  socket.on('payment:start', async (data: {
    paymentId: string;
    amount: number;
    posIp: string;
    posPort: number;
  }) => {
    console.log(`\n💳 POS Payment request: ${data.paymentId} | Amount: ${data.amount} TL`);
    
    try {
      const result = await GMP3Handler.startSale(data.posIp, data.posPort, data.amount);
      
      socket.emit('payment:result', {
        paymentId: data.paymentId,
        success: result.success,
        message: result.message
      });

      if (result.success) {
        console.log(`   ✅ Payment ${data.paymentId} successful`);
      } else {
        console.log(`   ❌ Payment ${data.paymentId} failed: ${result.message}`);
      }
    } catch (error) {
      console.error(`   ❌ POS error:`, error);
      socket.emit('payment:result', {
        paymentId: data.paymentId,
        success: false,
        message: (error as Error).message
      });
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`\n🔌 Disconnected: ${reason}`);
  });

  socket.on('connect_error', (error) => {
    reconnectAttempts++;
    if (reconnectAttempts <= MAX_RECONNECT_DISPLAY) {
      console.log(`⚠️  Connection error (attempt ${reconnectAttempts}): ${error.message}`);
    } else if (reconnectAttempts === MAX_RECONNECT_DISPLAY + 1) {
      console.log(`⚠️  Continuing to retry silently...`);
    }
  });
}

// Start the agent
connect();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Print Agent shutting down...');
  socket?.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  socket?.disconnect();
  process.exit(0);
});
