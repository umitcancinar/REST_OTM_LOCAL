// ==========================================
// Print Service — Printer Management & Routing
// ==========================================

import { EventEmitter } from 'events';
import { Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import {
  normalizeLayout as buildLayout,
  PRINT_LAYOUT_KEYS,
  type PrintLayoutKey,
  type ReceiptLayout,
} from '@rest-otm/receipt-core';
import {
  resolvePreparationDepartment,
  KITCHEN_STATION_DEPARTMENTS,
  GRILL_STATION_DEPARTMENTS,
  STATION_PRINT_DEPARTMENTS,
} from '../../utils/department-routing';
import { enqueuePrintJob, reprintDeadJob } from './print-outbox.service';
import {
  type PrintJobListQuery,
  safePrintFailureCode,
} from './print-outbox.policy';

// Valid Department enum values from Prisma schema
const VALID_DEPARTMENTS = ['KITCHEN', 'BAR', 'GRILL', 'PASTRY', 'COLD', 'CASHIER', 'PAKET', 'POS'];

// Yazici IP adresleri artik yalnizca PrinterConfig tablosundan gelir.
// Burada bulunan sabit tablo (192.168.1.203 / .202) ilk musterinin yerel
// agina aitti; cok kiracili sistemde her restoranin agi farkli oldugu icin
// kaldirildi. IP tanimsizsa yazdirma reddedilir, tahmin edilmez.

// PrintLayout tipleri, varsayilanlari ve normalizasyonu @rest-otm/receipt-core
// paketine tasindi. Tek kaynak: admin onizlemesi ve print-agent ayni kodu kullanir.

function cleanText(value: unknown, fallback = '', maxLength = 160): string {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

function normalizeLayout(value: unknown, key: PrintLayoutKey, restaurantName: string): ReceiptLayout {
  return buildLayout(value, key, restaurantName);
}

function readTenantSettings(settings: unknown): Record<string, any> {
  if (typeof settings !== 'string') return (settings || {}) as Record<string, any>;
  try { return JSON.parse(settings); } catch { return {}; }
}

/** A printer can be assigned to any saved template without duplicating template data. */
function resolveLayout(settings: Record<string, any>, printerId: string | undefined, fallback: PrintLayoutKey) {
  const assignedKey = printerId ? settings.printerLayoutAssignments?.[printerId] : undefined;
  const layoutKey: PrintLayoutKey = PRINT_LAYOUT_KEYS.includes(assignedKey as PrintLayoutKey)
    ? assignedKey as PrintLayoutKey
    : fallback;
  return { layoutKey, layout: settings.printLayouts?.[layoutKey] || {} };
}

interface OperationalPrintJobRow {
  id: string;
  eventKey: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  leaseExpiresAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  printedAt: Date | null;
  deadAt: Date | null;
  retainUntil: Date | null;
  reprintOfId: string | null;
  printer: { id: string; name: string } | null;
  _count?: { attemptsAudit: number };
}

function operationalPrintJobView(job: OperationalPrintJobRow) {
  return {
    id: job.id,
    eventKey: job.eventKey,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    nextAttemptAt: job.nextAttemptAt,
    leaseExpiresAt: job.leaseExpiresAt,
    hasError: Boolean(job.lastError),
    errorCode: safePrintFailureCode(job.lastError),
    hasAmbiguousOutcome: (job._count?.attemptsAudit ?? 0) > 0,
    printer: job.printer,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    printedAt: job.printedAt,
    deadAt: job.deadAt,
    retainUntil: job.retainUntil,
    reprintOfId: job.reprintOfId,
  };
}

export const printService = {
  printJobEmitter: new EventEmitter(),

  async getPrinters(tenantId: string) {
    return prisma.printerConfig.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  },

  async getOperationsSummary(tenantId: string) {
    const { getIO } = await import('../../websocket/socket.server');
    const [sockets, grouped, ambiguousJobs, ambiguousAttempts] = await Promise.all([
      getIO().in(`tenant:${tenantId}:print-agents`).allSockets(),
      prisma.printJob.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      }),
      prisma.printJob.count({
        where: { tenantId, attemptsAudit: { some: { ambiguousAckLoss: true } } },
      }),
      prisma.printJobAttempt.count({
        where: { ambiguousAckLoss: true, job: { tenantId } },
      }),
    ]);
    const counts: Record<string, number> = {
      PENDING: 0,
      LEASED: 0,
      RETRY: 0,
      PRINTED: 0,
      DEAD: 0,
    };
    for (const row of grouped) counts[row.status] = row._count._all;
    return {
      agentConnected: sockets.size > 0,
      agentCount: sockets.size,
      checkedAt: new Date().toISOString(),
      outbox: {
        pending: counts.PENDING,
        leased: counts.LEASED,
        retry: counts.RETRY,
        printed: counts.PRINTED,
        dead: counts.DEAD,
        ambiguous: ambiguousJobs,
        ambiguousAttempts,
      },
    };
  },

  async getStatus(tenantId: string) {
    return this.getOperationsSummary(tenantId);
  },

  async listPrintJobs(tenantId: string, query: PrintJobListQuery) {
    const where: Prisma.PrintJobWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, jobs] = await prisma.$transaction([
      prisma.printJob.count({ where }),
      prisma.printJob.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          eventKey: true,
          status: true,
          attempts: true,
          maxAttempts: true,
          nextAttemptAt: true,
          leaseExpiresAt: true,
          lastError: true,
          createdAt: true,
          updatedAt: true,
          printedAt: true,
          deadAt: true,
          retainUntil: true,
          reprintOfId: true,
          printer: { select: { id: true, name: true } },
          _count: {
            select: { attemptsAudit: { where: { ambiguousAckLoss: true } } },
          },
        },
      }),
    ]);
    return {
      jobs: jobs.map(operationalPrintJobView),
      total,
      page: query.page,
      limit: query.limit,
    };
  },

  async getPrintJob(tenantId: string, jobId: string) {
    const job = await prisma.printJob.findFirst({
      where: { id: jobId, tenantId },
      select: {
        id: true,
        eventKey: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        nextAttemptAt: true,
        leaseExpiresAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
        printedAt: true,
        deadAt: true,
        retainUntil: true,
        reprintOfId: true,
        printer: { select: { id: true, name: true } },
        attemptsAudit: {
          orderBy: { attemptNumber: 'asc' },
          select: {
            attemptNumber: true,
            dispatchedAt: true,
            acknowledgedAt: true,
            success: true,
            ambiguousAckLoss: true,
          },
        },
        reprints: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            status: true,
            createdAt: true,
            printedAt: true,
            deadAt: true,
          },
        },
        _count: {
          select: { attemptsAudit: { where: { ambiguousAckLoss: true } } },
        },
      },
    });
    if (!job) throw Object.assign(new Error('Print job bulunamadı'), { statusCode: 404 });
    return {
      ...operationalPrintJobView(job),
      attemptsAudit: job.attemptsAudit,
      reprints: job.reprints,
    };
  },

  async reprintJob(tenantId: string, jobId: string, requestCommandId: string) {
    const job = await reprintDeadJob(tenantId, jobId, requestCommandId);
    const printer = job.printerId
      ? await prisma.printerConfig.findFirst({
          where: { id: job.printerId, tenantId },
          select: { id: true, name: true },
        })
      : null;
    return {
      requestCommandId,
      job: operationalPrintJobView({
        ...job,
        printer,
        _count: { attemptsAudit: 0 },
      }),
    };
  },

  async testPrinter(tenantId: string, printerId: string) {
    const printer = await prisma.printerConfig.findFirst({
      where: { id: printerId, tenantId, isActive: true },
    });
    if (!printer) throw new Error('Yazıcı bulunamadı veya pasif');
    if (printer.departments.includes('POS')) {
      throw new Error('POS terminaline termal test fişi gönderilemez');
    }
    if (!printer.ipAddress || !printer.port) {
      throw new Error('Test için yazıcının IP adresi ve portu tanımlanmalıdır');
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const settings = readTenantSettings(tenant?.settings);
    const fallback: PrintLayoutKey = printer.departments.includes('KITCHEN')
      ? 'KITCHEN'
      : printer.departments.includes('GRILL')
        ? 'GRILL'
        : printer.departments.includes('PAKET')
          ? 'PAKET'
          : 'CASHIER';
    const { layoutKey, layout: savedLayout } = resolveLayout(settings, printer.id, fallback);
    const layout = normalizeLayout(savedLayout, layoutKey, tenant?.name || 'REST_OTM');
    const jobId = `test-${printer.id}-${Date.now()}`;
    const eventName = layoutKey === 'KITCHEN' || layoutKey === 'GRILL'
      ? 'print:kitchen'
      : 'print:bill';
    const payload = layoutKey === 'KITCHEN' || layoutKey === 'GRILL'
      ? {
        jobId,
        department: layoutKey,
        ipAddress: printer.ipAddress,
        port: printer.port,
        orderNumber: 'TEST-001',
        tableNumber: 12,
        waiterName: 'Test Kullanıcısı',
        items: [
          { menuItemName: 'ADANA KEBAP', quantity: 2, price: 450, portionOption: 'Normal', notes: 'Az pişmiş' },
          { menuItemName: 'AYRAN', quantity: 1, price: 60, portionOption: 'Normal', notes: null },
        ],
        layout,
      }
      : {
        jobId,
        printer: printer.name,
        ipAddress: printer.ipAddress,
        port: printer.port,
        // The normalized layout is authoritative. Do not let an agent fallback
        // re-introduce the tenant name when the design hides/clears it.
        restaurantName: layout.elements.header.visible ? layout.headerText : '',
        orderNumber: 'TEST-001',
        tableNumber: layoutKey === 'PAKET' ? 0 : 12,
        waiterName: 'Test Kullanıcısı',
        customer: layoutKey === 'PAKET'
          ? { name: 'Örnek Müşteri', phone: '0555 000 00 00', address: 'Örnek Mahallesi No: 12' }
          : undefined,
        items: [
          { name: 'ADANA KEBAP', quantity: 2, price: 900 },
          { name: 'AYRAN', quantity: 1, price: 60 },
        ],
        total: 960,
        timestamp: new Date().toISOString(),
        layout,
      };
    await enqueuePrintJob({
      id: jobId,
      tenantId,
      printerId: printer.id,
      eventName,
      eventKey: 'PRINTER_TEST',
      idempotencyKey: jobId,
      payload: payload as any,
    });

    return new Promise<{ jobId: string; printer: string; success: boolean }>((resolve, reject) => {
      const eventName = `result:${jobId}`;
      const timeout = setTimeout(() => {
        this.printJobEmitter.removeAllListeners(eventName);
        reject(new Error('Yazıcı agentı 8 saniye içinde yanıt vermedi'));
      }, 8000);

      this.printJobEmitter.once(eventName, (data: { success: boolean; error?: string }) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve({ jobId, printer: printer.name, success: true });
        } else {
          reject(new Error(data.error || 'Test fişi yazıcıya gönderilemedi'));
        }
      });
    });
  },

  /**
   * Kalibrasyon fisi — uzerinde kendi beklenen olculeri yazili bir cetvel
   * basar. "Ekranda baska, kagitta baska" sikayetinde sebebi tahminle degil,
   * kagidi cetvelle olcerek bulmak icin kullanilir (bkz. receipt-core/
   * calibration.ts). Test fisiyle ayni akisi kullanir; tek farki agent'in
   * icerigi buildCalibrationDoc ile uretmesidir.
   */
  /**
   * Z raporunu (gun sonu ozeti) kasa yazicisina gonderir.
   * Veriyi reportService'ten alir — yani kagida basilan rakamlar
   * Raporlar ekranindakiyle AYNI kaynaktan gelir, ayrisamaz.
   */
  async printZReport(tenantId: string, startDate: string, endDate: string, rangeLabel?: string) {
    const { reportService } = await import('../reports/report.service');
    const summary = await reportService.getSummaryInRange(tenantId, startDate, endDate);

    // Adisyon fisiyle ayni yazici secimi: CASHIER > BAR > herhangi biri.
    let printer = await prisma.printerConfig.findFirst({
      where: { tenantId, isActive: true, departments: { has: 'CASHIER' as any } },
    });
    if (!printer) {
      printer = await prisma.printerConfig.findFirst({
        where: { tenantId, isActive: true, departments: { has: 'BAR' as any } },
      });
    }
    if (!printer) {
      printer = await prisma.printerConfig.findFirst({ where: { tenantId, isActive: true } });
    }
    if (!printer) throw new Error('Z raporu için aktif bir yazıcı tanımlanmamış');

    // Sabit IP'ye dusmek cok kiracili sistemde tehlikeli: Z raporu ciro
    // toplamlarini tasir ve '192.168.1.128' her restoranin agindaki farkli
    // bir cihazdir. IP tanimsizsa yazdirmayi reddet, tahmin etme.
    if (!printer.ipAddress) {
      throw new Error(
        `"${printer.name}" yazıcısının IP adresi tanımlı değil. ` +
          'Ayarlar > Yazıcılar bölümünden IP adresini girin.',
      );
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const tenantSettingsRaw = readTenantSettings(tenant?.settings);
    const { layoutKey, layout: savedLayout } = resolveLayout(tenantSettingsRaw, printer.id, 'CASHIER');
    const layout = normalizeLayout(savedLayout, layoutKey, tenant?.name || 'REST_OTM');

    const jobId = `zreport-${tenantId}-${Date.now()}`;
    const payload = {
      jobId,
      printer: printer.name,
      ipAddress: printer.ipAddress,
      port: printer.port || 9100,
      layout,
      restaurantName: tenant?.name || 'REST_OTM',
      rangeLabel: rangeLabel || (startDate === endDate ? startDate : `${startDate} - ${endDate}`),
      printedAt: new Date(),
      totalRevenue: summary.totalRevenue,
      totalOrders: summary.totalOrders,
      avgOrderValue: summary.avgOrderValue,
      paymentBreakdown: summary.paymentBreakdown,
      topSellingItems: summary.topSellingItems,
      waiterPerformance: summary.waiterPerformance,
    };
    await enqueuePrintJob({
      id: jobId,
      tenantId,
      printerId: printer.id,
      eventName: 'print:zreport',
      eventKey: 'Z_REPORT',
      idempotencyKey: jobId,
      payload: payload as any,
    });

    return new Promise<{ jobId: string; printer: string; success: boolean }>((resolve, reject) => {
      const eventName = `result:${jobId}`;
      const timeout = setTimeout(() => {
        this.printJobEmitter.removeAllListeners(eventName);
        reject(new Error('Yazıcı agentı 8 saniye içinde yanıt vermedi'));
      }, 8000);

      this.printJobEmitter.once(eventName, (data: { success: boolean; error?: string }) => {
        clearTimeout(timeout);
        if (data.success) resolve({ jobId, printer: printer!.name, success: true });
        else reject(new Error(data.error || 'Z raporu yazıcıya gönderilemedi'));
      });
    });
  },

  async calibratePrinter(tenantId: string, printerId: string) {
    const printer = await prisma.printerConfig.findFirst({
      where: { id: printerId, tenantId, isActive: true },
    });
    if (!printer) throw new Error('Yazıcı bulunamadı veya pasif');
    if (printer.departments.includes('POS')) {
      throw new Error('POS terminaline kalibrasyon fişi gönderilemez');
    }
    if (!printer.ipAddress || !printer.port) {
      throw new Error('Kalibrasyon için yazıcının IP adresi ve portu tanımlanmalıdır');
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const settings = readTenantSettings(tenant?.settings);
    const fallback: PrintLayoutKey = printer.departments.includes('KITCHEN')
      ? 'KITCHEN'
      : printer.departments.includes('GRILL')
        ? 'GRILL'
        : printer.departments.includes('PAKET')
          ? 'PAKET'
          : 'CASHIER';
    const { layoutKey, layout: savedLayout } = resolveLayout(settings, printer.id, fallback);
    const layout = normalizeLayout(savedLayout, layoutKey, tenant?.name || 'REST_OTM');
    const jobId = `calib-${printer.id}-${Date.now()}`;
    const payload = {
      jobId,
      printer: printer.name,
      ipAddress: printer.ipAddress,
      port: printer.port,
      layoutKey,
      layout,
    };
    await enqueuePrintJob({
      id: jobId,
      tenantId,
      printerId: printer.id,
      eventName: 'print:calibration',
      eventKey: 'PRINTER_CALIBRATION',
      idempotencyKey: jobId,
      payload: payload as any,
    });

    return new Promise<{ jobId: string; printer: string; success: boolean }>((resolve, reject) => {
      const eventName = `result:${jobId}`;
      const timeout = setTimeout(() => {
        this.printJobEmitter.removeAllListeners(eventName);
        reject(new Error('Yazıcı agentı 8 saniye içinde yanıt vermedi'));
      }, 8000);

      this.printJobEmitter.once(eventName, (data: { success: boolean; error?: string }) => {
        clearTimeout(timeout);
        if (data.success) resolve({ jobId, printer: printer.name, success: true });
        else reject(new Error(data.error || 'Kalibrasyon fişi yazıcıya gönderilemedi'));
      });
    });
  },

  async createPrinter(tenantId: string, data: {
    name: string;
    type?: string;
    ipAddress?: string;
    port?: number;
    departments: string[];
  }) {
    const name = cleanText(data.name, '', 80);
    if (!name) throw new Error('Yazıcı adı gerekli');
    const port = Number(data.port ?? 9100);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Geçerli bir yazıcı portu girin');
    const validDepts = (Array.isArray(data.departments) ? data.departments : [])
      .filter(d => VALID_DEPARTMENTS.includes(d));
    if (validDepts.length === 0) throw new Error('Yazıcı için en az bir geçerli bölüm seçilmelidir');

    return prisma.printerConfig.create({
      data: {
        tenantId,
        name,
        type: cleanText(data.type, 'RECEIPT', 40),
        ipAddress: cleanText(data.ipAddress, '', 120) || null,
        port,
        departments: validDepts,
      } as any,
    });
  },

  async updatePrinter(tenantId: string, id: string, data: Record<string, unknown>) {
    // Verify the printer belongs to this tenant before updating
    const existing = await prisma.printerConfig.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new Error('Printer not found');
    }

    // Sanitize: only allow known fields to be updated
    const sanitized: Record<string, unknown> = {};
    if (data.name !== undefined) {
      const name = cleanText(data.name, '', 80);
      if (!name) throw new Error('Yazıcı adı gerekli');
      sanitized.name = name;
    }
    if (data.type !== undefined) sanitized.type = cleanText(data.type, 'RECEIPT', 40);
    if (data.ipAddress !== undefined) sanitized.ipAddress = cleanText(data.ipAddress, '', 120) || null;
    if (data.port !== undefined) {
      const port = Number(data.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Geçerli bir yazıcı portu girin');
      }
      sanitized.port = port;
    }
    if (data.isActive !== undefined) sanitized.isActive = Boolean(data.isActive);
    if (data.departments !== undefined && Array.isArray(data.departments)) {
      // Filter to only valid Department enum values
      const validDepts = (data.departments as string[]).filter(d => VALID_DEPARTMENTS.includes(d));
      if (validDepts.length === 0) throw new Error('Yazıcı için en az bir geçerli bölüm seçilmelidir');
      sanitized.departments = validDepts;
    }

    return prisma.printerConfig.update({ where: { id }, data: sanitized as any });
  },

  async deletePrinter(tenantId: string, id: string) {
    // Verify ownership first
    const existing = await prisma.printerConfig.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new Error('Printer not found');
    }
    return prisma.printerConfig.delete({ where: { id } });
  },

  /**
   * Route order items to the correct printers based on department.
   * Returns a map of printerId → items to print.
   */
  async routeOrderToPrinters(tenantId: string, orderItems: Array<{ department: string; menuItemName: string; quantity: number; notes?: string | null; portionOption: string }>) {
    const printers = await prisma.printerConfig.findMany({
      where: { tenantId, isActive: true },
    });

    const printJobs: Record<string, {
      printer: { id: string; name: string; type: string; ipAddress?: string | null; port?: number | null };
      items: typeof orderItems;
    }> = {};

    for (const item of orderItems) {
      // Find a printer that handles this department
      const printer = printers.find((p) =>
        p.departments.includes(item.department as any),
      );

      if (!printer) {
        logger.warn(`No printer configured for department: ${item.department}`);
        continue;
      }

      if (!printJobs[printer.id]) {
        printJobs[printer.id] = {
          printer: {
            id: printer.id,
            name: printer.name,
            type: printer.type,
            ipAddress: printer.ipAddress,
            port: printer.port,
          },
          items: [],
        };
      }

      printJobs[printer.id]!.items.push(item);
    }

    return printJobs;
  },

  /**
   * Send a bill (adisyon) print job to the Print Agent via WebSocket.
   */
  async printBill(tenantId: string, orderId: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId, isDeleted: false },
      include: {
        subChecks: { include: { items: true } },
        table: true,
        customer: true,
        waiter: { select: { name: true } },
      },
    });

    if (!order) throw new Error('Sipariş bulunamadı');

    // Adisyon için yazıcı bul: CASHIER > BAR > herhangi biri
    let printer = await prisma.printerConfig.findFirst({
      where: { tenantId, isActive: true, departments: { has: 'CASHIER' as any } },
    });
    if (!printer) {
      printer = await prisma.printerConfig.findFirst({
        where: { tenantId, isActive: true, departments: { has: 'BAR' as any } },
      });
    }
    if (!printer) {
      printer = await prisma.printerConfig.findFirst({ where: { tenantId, isActive: true } });
    }
    if (!printer) {
      throw new Error('Adisyon için aktif bir yazıcı tanımlanmamış');
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const items = order.subChecks.flatMap(sc =>
      sc.items
        .filter(i => i.status !== 'CANCELLED')
        .map(i => ({ name: i.menuItemName, quantity: i.quantity, price: i.totalPrice, notes: i.notes || undefined }))
    );

    // Tenant'ın özel çıktı tasarım ayarlarını çek
    const tenantSettingsRaw = readTenantSettings(tenant?.settings);
    const { layoutKey, layout: savedLayout } = resolveLayout(tenantSettingsRaw, printer.id, 'CASHIER');
    const layout = normalizeLayout(savedLayout, layoutKey, tenant?.name || 'REST_OTM');

    // Adisyon fisi musteri adi, telefonu ve adresini tasir. Sabit bir IP'ye
    // dusmek bu veriyi baska bir restoranin agindaki bilinmeyen cihaza
    // gondermek demektir (KVKK). IP yoksa yazdirmayi reddet.
    if (!printer.ipAddress) {
      throw Object.assign(
        new Error(
          `"${printer.name}" yazıcısının IP adresi tanımlı değil. ` +
            'Ayarlar > Yazıcılar bölümünden IP adresini girin.',
        ),
        { statusCode: 422 },
      );
    }

    const printJob = {
      jobId: `bill-${order.id}-${Date.now()}`,
      printer: printer.name,
      ipAddress: printer.ipAddress,
      port: printer.port || 9100,
      restaurantName: layout.elements.header.visible ? layout.headerText : '',
      orderNumber: order.orderNumber,
      tableNumber: order.table?.number || 0,
      waiterName: order.waiter?.name || 'Garson',
      customer: order.customer
        ? { name: order.customer.name, phone: order.customer.phone, address: order.customer.address }
        : undefined,
      items,
      total: order.grandTotal,
      paidAmount: order.paidAmount,
      payments: order.payments,
      timestamp: new Date().toISOString(),
      // Özel tasarım ayarları
      layout,
      // Frontend fallback için sipariş verisi
      orderData: {
        id: order.id,
        orderNumber: order.orderNumber,
        grandTotal: order.grandTotal,
        table: order.table,
        customer: order.customer,
        waiter: order.waiter,
        subChecks: order.subChecks,
      },
    };

    await enqueuePrintJob({
      id: printJob.jobId,
      tenantId,
      orderId: order.id,
      printerId: printer.id,
      eventName: 'print:bill',
      eventKey: 'BILL',
      idempotencyKey: printJob.jobId,
      payload: printJob as any,
    });
    logger.info(`🧾 Bill print job queued: ${printJob.jobId} → ${printJob.printer}`);

    // Fire-and-forget: 3 saniye bekle, sonuç gelmezse "queued" döndür
    return new Promise<{
      jobId: string;
      printer: string;
      queued?: boolean;
      error?: string;
      orderData?: any;
      department?: string;
      tenantSettings?: any;
    }>((resolve) => {
      const timeout = setTimeout(() => {
        this.printJobEmitter.removeAllListeners(`result:${printJob.jobId}`);
        logger.warn(`⚠️  Adisyon yazıcısı yanıt vermedi`);
        resolve({
          jobId:     printJob.jobId,
          printer:   printJob.printer,
          queued:    true,
          error:     'Yazıcı agentı veya kasa yazıcısı yanıt vermedi.',
          orderData: printJob.orderData,
          department: 'CASHIER',
          tenantSettings: tenantSettingsRaw,
        });
      }, 8000);

      this.printJobEmitter.once(`result:${printJob.jobId}`, (data: { success: boolean; error?: string }) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve({ jobId: printJob.jobId, printer: printJob.printer, tenantSettings: tenantSettingsRaw });
        } else {
          logger.warn(`⚠️  Adisyon yazıcı hatası: ${data.error}`);
          resolve({
            jobId:     printJob.jobId,
            printer:   printJob.printer,
            queued:    true,
            error:     data.error || 'Kasa yazıcısına gönderilemedi.',
            orderData: printJob.orderData,
            department: 'CASHIER',
            tenantSettings: tenantSettingsRaw,
          });
        }
      });
    });
  },

  /**
   * FIRIN yazıcısına (192.168.1.203:9100) fiş gönder.
   */
  async printKitchen(tenantId: string, orderId: string, itemIds?: string[]) {
    return this._printToStation(tenantId, orderId, 'KITCHEN', itemIds);
  },

  /**
   * IZGARA yazıcısına (192.168.1.202:9100) fiş gönder.
   */
  async printGrill(tenantId: string, orderId: string, itemIds?: string[]) {
    return this._printToStation(tenantId, orderId, 'GRILL', itemIds);
  },

  /**
   * Tek bir yazdırma isteğini sipariş satırlarının hazırlama bölümüne göre
   * otomatik olarak Fırın ve Izgara yazıcılarına ayırır.
   */
  async printProductionStations(tenantId: string, orderId: string, itemIds?: string[]) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId, isDeleted: false },
      select: {
        subChecks: {
          select: {
            items: {
              select: { id: true, menuItemId: true, department: true, status: true },
            },
          },
        },
      },
    });
    if (!order) throw Object.assign(new Error('Sipariş bulunamadı'), { statusCode: 404 });

    const selectedIds = itemIds?.length ? new Set(itemIds) : null;
    const activeItems = order.subChecks
      .flatMap((subCheck) => subCheck.items)
      .filter((item) => item.status !== 'CANCELLED' && (!selectedIds || selectedIds.has(item.id)));

    const currentMenuItems = await prisma.menuItem.findMany({
      where: {
        tenantId,
        id: { in: activeItems.map((item) => item.menuItemId) },
      },
      select: {
        id: true,
        department: true,
        category: { select: { name: true } },
      },
    });
    const currentMenuItemMap = new Map(currentMenuItems.map((item) => [item.id, item]));
    const routedItems = activeItems.map((item) => {
      const currentMenuItem = currentMenuItemMap.get(item.menuItemId);
      return {
        ...item,
        effectiveDepartment: resolvePreparationDepartment(
          currentMenuItem?.department || item.department,
          currentMenuItem?.category.name,
        ),
      };
    });

    // BAR (içecek) department is intentionally excluded from station prints.
    // It still appears on the adisyon (bill) but never goes to KITCHEN or GRILL.
    const stations: Array<{ department: 'KITCHEN' | 'GRILL'; itemCount: number }> = [];
    const kitchenItemCount = routedItems.filter((item) =>
      KITCHEN_STATION_DEPARTMENTS.has(item.effectiveDepartment as any),
    ).length;
    const grillItemCount = routedItems.filter((item) =>
      GRILL_STATION_DEPARTMENTS.has(item.effectiveDepartment as any),
    ).length;

    if (kitchenItemCount > 0) stations.push({ department: 'KITCHEN', itemCount: kitchenItemCount });
    if (grillItemCount > 0) stations.push({ department: 'GRILL', itemCount: grillItemCount });

    const totalStationItems = kitchenItemCount + grillItemCount;
    const totalItems = routedItems.length;
    const beverageCount = routedItems.filter((item) => item.effectiveDepartment === 'BAR').length;
    logger.info(
      `📊 Station routing: ${kitchenItemCount} KITCHEN, ${grillItemCount} GRILL, ${beverageCount} BAR (skipped) / ${totalItems} total`,
    );

    if (stations.length === 0) {
      if (beverageCount === totalItems) {
        // All items are beverages — log and return gracefully instead of throwing
        logger.info('ℹ️  All order items are beverages (BAR) — no station print required');
        return {
          success: true,
          queued: false,
          jobs: [],
          printedStations: [],
          error: undefined,
          skipped: 'BAR_ONLY',
        };
      }
      throw Object.assign(
        new Error('Siparişte Fırın veya Izgara istasyonuna atanmış aktif ürün yok'),
        { statusCode: 422 },
      );
    }

    const jobs = await Promise.all(stations.map(async (station) => {
      const result = await this._printToStation(tenantId, orderId, station.department, itemIds);
      return {
        ...result,
        department: station.department,
        itemCount: station.itemCount,
        success: !result.queued,
      };
    }));

    const failedJobs = jobs.filter((job) => !job.success);
    return {
      success: failedJobs.length === 0,
      queued: failedJobs.length > 0,
      jobs,
      printedStations: jobs.filter((job) => job.success).map((job) => job.department),
      error: failedJobs.map((job) => `${job.printer}: ${job.error || 'Yazdırılamadı'}`).join(' | ') || undefined,
    };
  },

  /**
   * PAKET sipariş yazdır (Adisyon fişinin PAKET layout'u ile versiyonu)
   */
  async printPaket(tenantId: string, orderId: string, preferredPrinterId?: string, paymentMethod?: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId, isDeleted: false },
      include: {
        subChecks: { include: { items: true } },
        table: true,
        customer: true,
        waiter: { select: { name: true } },
      },
    });
    if (!order) throw new Error('Sipariş bulunamadı');

    let printer = preferredPrinterId
      ? await prisma.printerConfig.findFirst({ where: { id: preferredPrinterId, tenantId, isActive: true } })
      : await prisma.printerConfig.findFirst({ where: { tenantId, isActive: true, departments: { has: 'PAKET' } } });
    if (preferredPrinterId && !printer) throw new Error('Seçilen paket yazıcısı bulunamadı veya aktif değil');
    if (!printer) {
      printer = await prisma.printerConfig.findFirst({
        where: { tenantId, isActive: true, departments: { has: 'CASHIER' } },
      });
    }
    if (!printer) {
      throw new Error('Paket sipariş için aktif bir yazıcı tanımlanmamış');
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const items = order.subChecks.flatMap(sc =>
      sc.items
        .filter(i => i.status !== 'CANCELLED')
        .map(i => ({ name: i.menuItemName, quantity: i.quantity, price: i.totalPrice, notes: i.notes || undefined }))
    );

    const tenantSettingsRaw = readTenantSettings(tenant?.settings);
    const { layoutKey, layout: savedLayout } = resolveLayout(tenantSettingsRaw, printer.id, 'PAKET');
    const layout = normalizeLayout(savedLayout, layoutKey, tenant?.name || 'REST_OTM');

    const printJob = {
      jobId: `paket-${order.id}-${Date.now()}`,
      printer: printer.name,
      ipAddress: printer.ipAddress,
      port: printer.port || 9100,
      restaurantName: layout.elements.header.visible ? layout.headerText : '',
      orderNumber: order.orderNumber,
      tableNumber: order.table?.number || 0,
      waiterName: order.waiter?.name || 'Garson',
      customer: order.customer
        ? { name: order.customer.name, phone: order.customer.phone, address: order.customer.address }
        : undefined,
      items,
      total: order.grandTotal,
      timestamp: new Date().toISOString(),
      layout,
      // Ödeme tipi — paket fişinde görünsün
      paymentMethod: paymentMethod || (order as any).paymentMethod || null,
      notes: order.notes || null,
      orderData: {
        id: order.id,
        orderNumber: order.orderNumber,
        grandTotal: order.grandTotal,
        table: order.table,
        customer: order.customer,
        waiter: order.waiter,
        subChecks: order.subChecks,
      },
    };

    await enqueuePrintJob({
      id: printJob.jobId,
      tenantId,
      orderId: order.id,
      printerId: printer.id,
      eventName: 'print:bill',
      eventKey: 'TAKEAWAY',
      idempotencyKey: printJob.jobId,
      payload: printJob as any,
    });
    logger.info(`📦 Paket print job queued: ${printJob.jobId} → ${printJob.printer}`);

    return new Promise<{
      jobId: string;
      printer: string;
      queued?: boolean;
      error?: string;
      orderData?: any;
      department?: string;
      tenantSettings?: any;
    }>((resolve) => {
      const timeout = setTimeout(() => {
        this.printJobEmitter.removeAllListeners(`result:${printJob.jobId}`);
        resolve({
          jobId: printJob.jobId,
          printer: printJob.printer,
          queued: true,
          error: 'Yazıcı agentı veya paket yazıcısı yanıt vermedi.',
          orderData: printJob.orderData,
          department: 'PAKET',
          tenantSettings: tenantSettingsRaw,
        });
      }, 8000);

      this.printJobEmitter.once(`result:${printJob.jobId}`, (data: { success: boolean; error?: string }) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve({ jobId: printJob.jobId, printer: printJob.printer, tenantSettings: tenantSettingsRaw });
        } else {
          resolve({
            jobId: printJob.jobId,
            printer: printJob.printer,
            queued: true,
            error: data.error || 'Paket yazıcısına gönderilemedi.',
            orderData: printJob.orderData,
            department: 'PAKET',
            tenantSettings: tenantSettingsRaw,
          });
        }
      });
    });
  },


  async printItemUpdate(tenantId: string, orderId: string, itemId: string, updateType: 'CANCEL' | 'TREAT') {
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId, isDeleted: false },
      select: {
        subChecks: {
          select: {
            items: {
              select: { id: true, menuItemId: true, department: true, status: true },
            },
          },
        },
      },
    });
    if (!order) return null;

    const activeItems = order.subChecks.flatMap((subCheck) => subCheck.items);
    const item = activeItems.find(i => i.id === itemId);
    if (!item) return null;

    const currentMenuItem = await prisma.menuItem.findUnique({
      where: { id: item.menuItemId },
      select: { department: true, category: { select: { name: true } } }
    });

    const effectiveDepartment = resolvePreparationDepartment(
      currentMenuItem?.department || item.department,
      currentMenuItem?.category?.name
    );

    let station: 'KITCHEN' | 'GRILL' | null = null;
    if (KITCHEN_STATION_DEPARTMENTS.has(effectiveDepartment as any)) station = 'KITCHEN';
    else if (GRILL_STATION_DEPARTMENTS.has(effectiveDepartment as any)) station = 'GRILL';

    if (!station) return null;

    return this._printToStation(tenantId, orderId, station, [itemId], { 
      isCancel: updateType === 'CANCEL', 
      isTreat: updateType === 'TREAT' 
    });
  },

  /**
   * İç yardımcı: KITCHEN veya GRILL için yazdırma işlemini yürütür.
   *
   * Fire-and-forget pattern:
   * - WebSocket üzerinden print:kitchen event'i yayınlar
   * - 3 saniye içinde print agent'tan onay gelirse → success
   * - Agent/yazıcı yanıt vermezse → "queued: true" ve açıklayıcı hata döner
   * - Tarayıcı yazdırma fallback'i yoktur
   *
   * Doğru IP'ler:
   *   FIRIN  (KITCHEN) → 192.168.1.203 : 9100
   *   IZGARA (GRILL)   → 192.168.1.202 : 9100
   */
  async _printToStation(
    tenantId: string,
    orderId: string,
    department: 'KITCHEN' | 'GRILL',
    itemIds?: string[],
    options?: { isCancel?: boolean; isTreat?: boolean }
  ) {
    // 1. Siparişi DB'den çek
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId, isDeleted: false },
      include: {
        subChecks: { include: { items: true } },
        table: true,
        waiter: { select: { name: true } },
      },
    });
    if (!order) throw new Error('Sipariş bulunamadı');

    const orderItems = order.subChecks.flatMap((subCheck) => subCheck.items);
    const currentMenuItems = await prisma.menuItem.findMany({
      where: {
        tenantId,
        id: { in: orderItems.map((item) => item.menuItemId) },
      },
      select: {
        id: true,
        department: true,
        category: { select: { name: true } },
      },
    });
    const currentMenuItemMap = new Map(currentMenuItems.map((item) => [item.id, item]));

    // 3. DB'den yazıcı kaydını bul (department etiketine göre)
    let dbPrinter = await prisma.printerConfig.findFirst({
      where: { tenantId, isActive: true, departments: { has: department as any } },
    });

    // Fallback: isim içinde "Fır" veya "Izgara" geçen yazıcıya bak
    if (!dbPrinter) {
      const namePart = department === 'KITCHEN' ? 'Fır' : 'Izgara';
      dbPrinter = await prisma.printerConfig.findFirst({
        where: { tenantId, isActive: true, name: { contains: namePart, mode: 'insensitive' } },
      });
    }

    // Use the authoritative shared constant — no DB intersection, no fallback ambiguity.
    // KITCHEN station prints: KITCHEN + COLD + PASTRY items
    // GRILL   station prints: GRILL items only
    // BAR items are NEVER sent to any station (appear only on the adisyon).
    const allowedDepartments: ReadonlySet<string> = department === 'KITCHEN'
      ? KITCHEN_STATION_DEPARTMENTS
      : GRILL_STATION_DEPARTMENTS;

    const selectedItemIds = itemIds?.length ? new Set(itemIds) : null;

    const items = order.subChecks.flatMap(sc =>
      sc.items
        .filter(item => {
          const currentMenuItem = currentMenuItemMap.get(item.menuItemId);
          const effectiveDepartment = resolvePreparationDepartment(
            currentMenuItem?.department || item.department,
            currentMenuItem?.category.name,
          );
          const statusMatch = options?.isCancel
            ? item.status === 'CANCELLED'
            : item.status !== 'CANCELLED';

          return statusMatch
            && allowedDepartments.has(effectiveDepartment)
            && (!selectedItemIds || selectedItemIds.has(item.id));
        })
        .map(item => ({
          menuItemName:  item.menuItemName,
          quantity:      item.quantity,
          price:         item.quantity > 0 ? item.totalPrice / item.quantity : item.totalPrice,
          portionOption: (item as any).portionOption || 'Normal',
          notes:         item.notes || null,
          isCancel:      options?.isCancel,
          isTreat:       options?.isTreat || item.isTreat,
        }))
    );

    if (items.length === 0) {
      throw Object.assign(new Error('Bu istasyon için yazdırılacak aktif ürün yok'), { statusCode: 422 });
    }

    // 4. IP / Port — yalnizca DB'den. Sabit adrese dusme YOK: '192.168.1.203'
    //    her restoranin agindaki farkli bir cihazdir. Yanlis mutfaga fis
    //    basmaktansa anlasilir bir hata vermek dogru davranistir.
    if (!dbPrinter?.ipAddress) {
      throw Object.assign(
        new Error(
          `${department} istasyonu için yazıcı IP adresi tanımlı değil. ` +
            'Ayarlar > Yazıcılar bölümünden yazıcıyı ekleyin.',
        ),
        { statusCode: 422 },
      );
    }
    const printerIp   = dbPrinter.ipAddress;
    const printerPort = dbPrinter.port || 9100;
    const printerName = dbPrinter.name;

    // 5. Tenant'ın özel çıktı tasarım ayarlarını çek
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    const tenantSettings = readTenantSettings(tenant?.settings);
    const fallbackLayoutKey: PrintLayoutKey = department === 'KITCHEN' ? 'KITCHEN' : 'GRILL';
    const { layoutKey, layout: savedLayout } = resolveLayout(tenantSettings, dbPrinter?.id, fallbackLayoutKey);
    const layout = normalizeLayout(savedLayout, layoutKey, tenant?.name || 'REST_OTM');

    if (options?.isCancel) {
      layout.receiptTitle = 'İPTAL FİŞİ';
      (layout as any).isCancel = true;
    } else if (options?.isTreat) {
      layout.receiptTitle = 'İKRAM FİŞİ';
      (layout as any).isTreat = true;
    }

    // DEBUG: Tenant layout değerlerini logla
    logger.info(`🎨 [${department}] ${layoutKey} template selected for ${printerName}`);

    // 6. Print job oluştur ve WebSocket üzerinden yayınla
    const printJob = {
      jobId:       `${department.toLowerCase()}-${order.id}-${Date.now()}`,
      department,
      ipAddress:   printerIp,
      port:        printerPort,
      orderNumber: order.orderNumber,
      tableNumber: order.table?.number || 0,
      waiterName:  order.waiter?.name || '',
      items,
      // Özel tasarım ayarları — print agent bu bilgiyle fişi özelleştirir
      layout,
      // Frontend fallback için tam sipariş verisi
      orderData: {
        id:          order.id,
        orderNumber: order.orderNumber,
        grandTotal:  order.grandTotal,
        table:       order.table,
        waiter:      order.waiter,
        subChecks:   order.subChecks,
      },
    };

    await enqueuePrintJob({
      id: printJob.jobId,
      tenantId,
      orderId: order.id,
      printerId: dbPrinter.id,
      eventName: 'print:kitchen',
      eventKey: options?.isCancel
        ? `ITEM_CANCEL:${department}`
        : options?.isTreat
          ? `ITEM_TREAT:${department}`
          : `MANUAL_STATION:${department}`,
      idempotencyKey: printJob.jobId,
      payload: printJob as any,
    });

    logger.info(
      `🍳 ${department} print job: ${printJob.jobId} → ${printerName} (${printerIp}:${printerPort}) | `
      + `${items.map((item) => `${item.quantity}x ${item.menuItemName}`).join(', ')}`,
    );

    // Fire-and-forget: 3 saniye bekle — sonuç gelmezse HATA ATMAZ, "queued" döner
    return new Promise<{
      jobId:      string;
      printer:    string;
      ip:         string;
      port:       number;
      queued?:    boolean;
      error?:     string;
      orderData?: any;
      department?: string;
      tenantSettings?: any;
    }>((resolve) => {
      const timeout = setTimeout(() => {
        this.printJobEmitter.removeAllListeners(`result:${printJob.jobId}`);
        logger.warn(`⚠️  ${printerName} (${printerIp}:${printerPort}) yanıt vermedi`);
        resolve({
          jobId:      printJob.jobId,
          printer:    printerName,
          ip:         printerIp,
          port:       printerPort,
          queued:     true,        // ← frontend'e "browser'dan bas" sinyali
          error:      'Yazıcı agentı veya seçilen yazıcı yanıt vermedi.',
          orderData:  printJob.orderData,
          department,
          tenantSettings: tenantSettings,
        });
      }, 8000);

      this.printJobEmitter.once(`result:${printJob.jobId}`, (data: { success: boolean; error?: string }) => {
        clearTimeout(timeout);
        if (data.success) {
          // Print agent başarıyla yazdırdı
          resolve({ jobId: printJob.jobId, printer: printerName, ip: printerIp, port: printerPort, tenantSettings: tenantSettings });
        } else {
          // Print agent bağlandı ama yazıcı hatası → frontend fallback
          logger.error(`❌ ${printerName} yazdırma hatası: ${data.error}`);
          resolve({
            jobId:      printJob.jobId,
            printer:    printerName,
            ip:         printerIp,
            port:       printerPort,
            queued:     true,
            error:      data.error || 'Yazıcıya gönderilemedi.',
            orderData:  printJob.orderData,
            department,
            tenantSettings: tenantSettings,
          });
        }
      });
    });
  },
};
