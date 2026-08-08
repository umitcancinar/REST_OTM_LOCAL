"use strict";
// ==========================================
// Print Service — Printer Management & Routing
// ==========================================
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.printService = void 0;
const events_1 = require("events");
const database_1 = __importDefault(require("../../config/database"));
const logger_1 = require("../../utils/logger");
const receipt_core_1 = require("@rest-otm/receipt-core");
const department_routing_1 = require("../../utils/department-routing");
// Valid Department enum values from Prisma schema
const VALID_DEPARTMENTS = ['KITCHEN', 'BAR', 'GRILL', 'PASTRY', 'COLD', 'CASHIER', 'PAKET', 'POS'];
// Yazici IP adresleri artik yalnizca PrinterConfig tablosundan gelir.
// Burada bulunan sabit tablo (192.168.1.203 / .202) ilk musterinin yerel
// agina aitti; cok kiracili sistemde her restoranin agi farkli oldugu icin
// kaldirildi. IP tanimsizsa yazdirma reddedilir, tahmin edilmez.
// PrintLayout tipleri, varsayilanlari ve normalizasyonu @rest-otm/receipt-core
// paketine tasindi. Tek kaynak: admin onizlemesi ve print-agent ayni kodu kullanir.
function cleanText(value, fallback = '', maxLength = 160) {
    if (typeof value !== 'string')
        return fallback;
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}
function normalizeLayout(value, key, restaurantName) {
    return (0, receipt_core_1.normalizeLayout)(value, key, restaurantName);
}
function readTenantSettings(settings) {
    if (typeof settings !== 'string')
        return (settings || {});
    try {
        return JSON.parse(settings);
    }
    catch {
        return {};
    }
}
/** A printer can be assigned to any saved template without duplicating template data. */
function resolveLayout(settings, printerId, fallback) {
    const assignedKey = printerId ? settings.printerLayoutAssignments?.[printerId] : undefined;
    const layoutKey = receipt_core_1.PRINT_LAYOUT_KEYS.includes(assignedKey)
        ? assignedKey
        : fallback;
    return { layoutKey, layout: settings.printLayouts?.[layoutKey] || {} };
}
exports.printService = {
    printJobEmitter: new events_1.EventEmitter(),
    async getPrinters(tenantId) {
        return database_1.default.printerConfig.findMany({
            where: { tenantId },
            orderBy: { name: 'asc' },
        });
    },
    async getStatus(tenantId) {
        const { getIO } = await Promise.resolve().then(() => __importStar(require('../../websocket/socket.server')));
        const sockets = await getIO().in(`tenant:${tenantId}:print-agents`).allSockets();
        return {
            agentConnected: sockets.size > 0,
            agentCount: sockets.size,
            checkedAt: new Date().toISOString(),
        };
    },
    async testPrinter(tenantId, printerId) {
        const printer = await database_1.default.printerConfig.findFirst({
            where: { id: printerId, tenantId, isActive: true },
        });
        if (!printer)
            throw new Error('Yazıcı bulunamadı veya pasif');
        if (printer.departments.includes('POS')) {
            throw new Error('POS terminaline termal test fişi gönderilemez');
        }
        if (!printer.ipAddress || !printer.port) {
            throw new Error('Test için yazıcının IP adresi ve portu tanımlanmalıdır');
        }
        const tenant = await database_1.default.tenant.findUnique({ where: { id: tenantId } });
        const settings = readTenantSettings(tenant?.settings);
        const fallback = printer.departments.includes('KITCHEN')
            ? 'KITCHEN'
            : printer.departments.includes('GRILL')
                ? 'GRILL'
                : printer.departments.includes('PAKET')
                    ? 'PAKET'
                    : 'CASHIER';
        const { layoutKey, layout: savedLayout } = resolveLayout(settings, printer.id, fallback);
        const layout = normalizeLayout(savedLayout, layoutKey, tenant?.name || 'REST_OTM');
        const jobId = `test-${printer.id}-${Date.now()}`;
        const { getIO } = await Promise.resolve().then(() => __importStar(require('../../websocket/socket.server')));
        const io = getIO();
        if (layoutKey === 'KITCHEN' || layoutKey === 'GRILL') {
            io.to(`tenant:${tenantId}`).emit('print:kitchen', {
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
            });
        }
        else {
            io.to(`tenant:${tenantId}`).emit('print:bill', {
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
            });
        }
        return new Promise((resolve, reject) => {
            const eventName = `result:${jobId}`;
            const timeout = setTimeout(() => {
                this.printJobEmitter.removeAllListeners(eventName);
                reject(new Error('Yazıcı agentı 8 saniye içinde yanıt vermedi'));
            }, 8000);
            this.printJobEmitter.once(eventName, (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve({ jobId, printer: printer.name, success: true });
                }
                else {
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
    async printZReport(tenantId, startDate, endDate, rangeLabel) {
        const { reportService } = await Promise.resolve().then(() => __importStar(require('../reports/report.service')));
        const summary = await reportService.getSummaryInRange(tenantId, startDate, endDate);
        // Adisyon fisiyle ayni yazici secimi: CASHIER > BAR > herhangi biri.
        let printer = await database_1.default.printerConfig.findFirst({
            where: { tenantId, isActive: true, departments: { has: 'CASHIER' } },
        });
        if (!printer) {
            printer = await database_1.default.printerConfig.findFirst({
                where: { tenantId, isActive: true, departments: { has: 'BAR' } },
            });
        }
        if (!printer) {
            printer = await database_1.default.printerConfig.findFirst({ where: { tenantId, isActive: true } });
        }
        if (!printer)
            throw new Error('Z raporu için aktif bir yazıcı tanımlanmamış');
        // Sabit IP'ye dusmek cok kiracili sistemde tehlikeli: Z raporu ciro
        // toplamlarini tasir ve '192.168.1.128' her restoranin agindaki farkli
        // bir cihazdir. IP tanimsizsa yazdirmayi reddet, tahmin etme.
        if (!printer.ipAddress) {
            throw new Error(`"${printer.name}" yazıcısının IP adresi tanımlı değil. ` +
                'Ayarlar > Yazıcılar bölümünden IP adresini girin.');
        }
        const tenant = await database_1.default.tenant.findUnique({ where: { id: tenantId } });
        const tenantSettingsRaw = readTenantSettings(tenant?.settings);
        const { layoutKey, layout: savedLayout } = resolveLayout(tenantSettingsRaw, printer.id, 'CASHIER');
        const layout = normalizeLayout(savedLayout, layoutKey, tenant?.name || 'REST_OTM');
        const jobId = `zreport-${tenantId}-${Date.now()}`;
        const { getIO } = await Promise.resolve().then(() => __importStar(require('../../websocket/socket.server')));
        getIO().to(`tenant:${tenantId}`).emit('print:zreport', {
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
        });
        return new Promise((resolve, reject) => {
            const eventName = `result:${jobId}`;
            const timeout = setTimeout(() => {
                this.printJobEmitter.removeAllListeners(eventName);
                reject(new Error('Yazıcı agentı 8 saniye içinde yanıt vermedi'));
            }, 8000);
            this.printJobEmitter.once(eventName, (data) => {
                clearTimeout(timeout);
                if (data.success)
                    resolve({ jobId, printer: printer.name, success: true });
                else
                    reject(new Error(data.error || 'Z raporu yazıcıya gönderilemedi'));
            });
        });
    },
    async calibratePrinter(tenantId, printerId) {
        const printer = await database_1.default.printerConfig.findFirst({
            where: { id: printerId, tenantId, isActive: true },
        });
        if (!printer)
            throw new Error('Yazıcı bulunamadı veya pasif');
        if (printer.departments.includes('POS')) {
            throw new Error('POS terminaline kalibrasyon fişi gönderilemez');
        }
        if (!printer.ipAddress || !printer.port) {
            throw new Error('Kalibrasyon için yazıcının IP adresi ve portu tanımlanmalıdır');
        }
        const tenant = await database_1.default.tenant.findUnique({ where: { id: tenantId } });
        const settings = readTenantSettings(tenant?.settings);
        const fallback = printer.departments.includes('KITCHEN')
            ? 'KITCHEN'
            : printer.departments.includes('GRILL')
                ? 'GRILL'
                : printer.departments.includes('PAKET')
                    ? 'PAKET'
                    : 'CASHIER';
        const { layoutKey, layout: savedLayout } = resolveLayout(settings, printer.id, fallback);
        const layout = normalizeLayout(savedLayout, layoutKey, tenant?.name || 'REST_OTM');
        const jobId = `calib-${printer.id}-${Date.now()}`;
        const { getIO } = await Promise.resolve().then(() => __importStar(require('../../websocket/socket.server')));
        getIO().to(`tenant:${tenantId}`).emit('print:calibration', {
            jobId,
            printer: printer.name,
            ipAddress: printer.ipAddress,
            port: printer.port,
            layoutKey,
            layout,
        });
        return new Promise((resolve, reject) => {
            const eventName = `result:${jobId}`;
            const timeout = setTimeout(() => {
                this.printJobEmitter.removeAllListeners(eventName);
                reject(new Error('Yazıcı agentı 8 saniye içinde yanıt vermedi'));
            }, 8000);
            this.printJobEmitter.once(eventName, (data) => {
                clearTimeout(timeout);
                if (data.success)
                    resolve({ jobId, printer: printer.name, success: true });
                else
                    reject(new Error(data.error || 'Kalibrasyon fişi yazıcıya gönderilemedi'));
            });
        });
    },
    async createPrinter(tenantId, data) {
        const name = cleanText(data.name, '', 80);
        if (!name)
            throw new Error('Yazıcı adı gerekli');
        const port = Number(data.port ?? 9100);
        if (!Number.isInteger(port) || port < 1 || port > 65535)
            throw new Error('Geçerli bir yazıcı portu girin');
        const validDepts = (Array.isArray(data.departments) ? data.departments : [])
            .filter(d => VALID_DEPARTMENTS.includes(d));
        if (validDepts.length === 0)
            throw new Error('Yazıcı için en az bir geçerli bölüm seçilmelidir');
        return database_1.default.printerConfig.create({
            data: {
                tenantId,
                name,
                type: cleanText(data.type, 'RECEIPT', 40),
                ipAddress: cleanText(data.ipAddress, '', 120) || null,
                port,
                departments: validDepts,
            },
        });
    },
    async updatePrinter(tenantId, id, data) {
        // Verify the printer belongs to this tenant before updating
        const existing = await database_1.default.printerConfig.findFirst({ where: { id, tenantId } });
        if (!existing) {
            throw new Error('Printer not found');
        }
        // Sanitize: only allow known fields to be updated
        const sanitized = {};
        if (data.name !== undefined) {
            const name = cleanText(data.name, '', 80);
            if (!name)
                throw new Error('Yazıcı adı gerekli');
            sanitized.name = name;
        }
        if (data.type !== undefined)
            sanitized.type = cleanText(data.type, 'RECEIPT', 40);
        if (data.ipAddress !== undefined)
            sanitized.ipAddress = cleanText(data.ipAddress, '', 120) || null;
        if (data.port !== undefined) {
            const port = Number(data.port);
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                throw new Error('Geçerli bir yazıcı portu girin');
            }
            sanitized.port = port;
        }
        if (data.isActive !== undefined)
            sanitized.isActive = Boolean(data.isActive);
        if (data.departments !== undefined && Array.isArray(data.departments)) {
            // Filter to only valid Department enum values
            const validDepts = data.departments.filter(d => VALID_DEPARTMENTS.includes(d));
            if (validDepts.length === 0)
                throw new Error('Yazıcı için en az bir geçerli bölüm seçilmelidir');
            sanitized.departments = validDepts;
        }
        return database_1.default.printerConfig.update({ where: { id }, data: sanitized });
    },
    async deletePrinter(tenantId, id) {
        // Verify ownership first
        const existing = await database_1.default.printerConfig.findFirst({ where: { id, tenantId } });
        if (!existing) {
            throw new Error('Printer not found');
        }
        return database_1.default.printerConfig.delete({ where: { id } });
    },
    /**
     * Route order items to the correct printers based on department.
     * Returns a map of printerId → items to print.
     */
    async routeOrderToPrinters(tenantId, orderItems) {
        const printers = await database_1.default.printerConfig.findMany({
            where: { tenantId, isActive: true },
        });
        const printJobs = {};
        for (const item of orderItems) {
            // Find a printer that handles this department
            const printer = printers.find((p) => p.departments.includes(item.department));
            if (!printer) {
                logger_1.logger.warn(`No printer configured for department: ${item.department}`);
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
            printJobs[printer.id].items.push(item);
        }
        return printJobs;
    },
    /**
     * Send a bill (adisyon) print job to the Print Agent via WebSocket.
     */
    async printBill(tenantId, orderId) {
        const order = await database_1.default.order.findFirst({
            where: { id: orderId, tenantId, isDeleted: false },
            include: {
                subChecks: { include: { items: true } },
                table: true,
                customer: true,
                waiter: { select: { name: true } },
            },
        });
        if (!order)
            throw new Error('Sipariş bulunamadı');
        // Adisyon için yazıcı bul: CASHIER > BAR > herhangi biri
        let printer = await database_1.default.printerConfig.findFirst({
            where: { tenantId, isActive: true, departments: { has: 'CASHIER' } },
        });
        if (!printer) {
            printer = await database_1.default.printerConfig.findFirst({
                where: { tenantId, isActive: true, departments: { has: 'BAR' } },
            });
        }
        if (!printer) {
            printer = await database_1.default.printerConfig.findFirst({ where: { tenantId, isActive: true } });
        }
        if (!printer) {
            throw new Error('Adisyon için aktif bir yazıcı tanımlanmamış');
        }
        const tenant = await database_1.default.tenant.findUnique({ where: { id: tenantId } });
        const items = order.subChecks.flatMap(sc => sc.items
            .filter(i => i.status !== 'CANCELLED')
            .map(i => ({ name: i.menuItemName, quantity: i.quantity, price: i.totalPrice, notes: i.notes || undefined })));
        // Tenant'ın özel çıktı tasarım ayarlarını çek
        const tenantSettingsRaw = readTenantSettings(tenant?.settings);
        const { layoutKey, layout: savedLayout } = resolveLayout(tenantSettingsRaw, printer.id, 'CASHIER');
        const layout = normalizeLayout(savedLayout, layoutKey, tenant?.name || 'REST_OTM');
        // Adisyon fisi musteri adi, telefonu ve adresini tasir. Sabit bir IP'ye
        // dusmek bu veriyi baska bir restoranin agindaki bilinmeyen cihaza
        // gondermek demektir (KVKK). IP yoksa yazdirmayi reddet.
        if (!printer.ipAddress) {
            throw Object.assign(new Error(`"${printer.name}" yazıcısının IP adresi tanımlı değil. ` +
                'Ayarlar > Yazıcılar bölümünden IP adresini girin.'), { statusCode: 422 });
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
        const { getIO } = await Promise.resolve().then(() => __importStar(require('../../websocket/socket.server')));
        const io = getIO();
        io.to(`tenant:${tenantId}`).emit('print:bill', printJob);
        logger_1.logger.info(`🧾 Bill print job sent: ${printJob.jobId} → ${printJob.printer}`);
        // Fire-and-forget: 3 saniye bekle, sonuç gelmezse "queued" döndür
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.printJobEmitter.removeAllListeners(`result:${printJob.jobId}`);
                logger_1.logger.warn(`⚠️  Adisyon yazıcısı yanıt vermedi`);
                resolve({
                    jobId: printJob.jobId,
                    printer: printJob.printer,
                    queued: true,
                    error: 'Yazıcı agentı veya kasa yazıcısı yanıt vermedi.',
                    orderData: printJob.orderData,
                    department: 'CASHIER',
                    tenantSettings: tenantSettingsRaw,
                });
            }, 8000);
            this.printJobEmitter.once(`result:${printJob.jobId}`, (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve({ jobId: printJob.jobId, printer: printJob.printer, tenantSettings: tenantSettingsRaw });
                }
                else {
                    logger_1.logger.warn(`⚠️  Adisyon yazıcı hatası: ${data.error}`);
                    resolve({
                        jobId: printJob.jobId,
                        printer: printJob.printer,
                        queued: true,
                        error: data.error || 'Kasa yazıcısına gönderilemedi.',
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
    async printKitchen(tenantId, orderId, itemIds) {
        return this._printToStation(tenantId, orderId, 'KITCHEN', itemIds);
    },
    /**
     * IZGARA yazıcısına (192.168.1.202:9100) fiş gönder.
     */
    async printGrill(tenantId, orderId, itemIds) {
        return this._printToStation(tenantId, orderId, 'GRILL', itemIds);
    },
    /**
     * Tek bir yazdırma isteğini sipariş satırlarının hazırlama bölümüne göre
     * otomatik olarak Fırın ve Izgara yazıcılarına ayırır.
     */
    async printProductionStations(tenantId, orderId, itemIds) {
        const order = await database_1.default.order.findFirst({
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
        if (!order)
            throw Object.assign(new Error('Sipariş bulunamadı'), { statusCode: 404 });
        const selectedIds = itemIds?.length ? new Set(itemIds) : null;
        const activeItems = order.subChecks
            .flatMap((subCheck) => subCheck.items)
            .filter((item) => item.status !== 'CANCELLED' && (!selectedIds || selectedIds.has(item.id)));
        const currentMenuItems = await database_1.default.menuItem.findMany({
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
                effectiveDepartment: (0, department_routing_1.resolvePreparationDepartment)(currentMenuItem?.department || item.department, currentMenuItem?.category.name),
            };
        });
        // BAR (içecek) department is intentionally excluded from station prints.
        // It still appears on the adisyon (bill) but never goes to KITCHEN or GRILL.
        const stations = [];
        const kitchenItemCount = routedItems.filter((item) => department_routing_1.KITCHEN_STATION_DEPARTMENTS.has(item.effectiveDepartment)).length;
        const grillItemCount = routedItems.filter((item) => department_routing_1.GRILL_STATION_DEPARTMENTS.has(item.effectiveDepartment)).length;
        if (kitchenItemCount > 0)
            stations.push({ department: 'KITCHEN', itemCount: kitchenItemCount });
        if (grillItemCount > 0)
            stations.push({ department: 'GRILL', itemCount: grillItemCount });
        const totalStationItems = kitchenItemCount + grillItemCount;
        const totalItems = routedItems.length;
        const beverageCount = routedItems.filter((item) => item.effectiveDepartment === 'BAR').length;
        logger_1.logger.info(`📊 Station routing: ${kitchenItemCount} KITCHEN, ${grillItemCount} GRILL, ${beverageCount} BAR (skipped) / ${totalItems} total`);
        if (stations.length === 0) {
            if (beverageCount === totalItems) {
                // All items are beverages — log and return gracefully instead of throwing
                logger_1.logger.info('ℹ️  All order items are beverages (BAR) — no station print required');
                return {
                    success: true,
                    queued: false,
                    jobs: [],
                    printedStations: [],
                    error: undefined,
                    skipped: 'BAR_ONLY',
                };
            }
            throw Object.assign(new Error('Siparişte Fırın veya Izgara istasyonuna atanmış aktif ürün yok'), { statusCode: 422 });
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
    async printPaket(tenantId, orderId, preferredPrinterId, paymentMethod) {
        const order = await database_1.default.order.findFirst({
            where: { id: orderId, tenantId, isDeleted: false },
            include: {
                subChecks: { include: { items: true } },
                table: true,
                customer: true,
                waiter: { select: { name: true } },
            },
        });
        if (!order)
            throw new Error('Sipariş bulunamadı');
        let printer = preferredPrinterId
            ? await database_1.default.printerConfig.findFirst({ where: { id: preferredPrinterId, tenantId, isActive: true } })
            : await database_1.default.printerConfig.findFirst({ where: { tenantId, isActive: true, departments: { has: 'PAKET' } } });
        if (preferredPrinterId && !printer)
            throw new Error('Seçilen paket yazıcısı bulunamadı veya aktif değil');
        if (!printer) {
            printer = await database_1.default.printerConfig.findFirst({
                where: { tenantId, isActive: true, departments: { has: 'CASHIER' } },
            });
        }
        if (!printer) {
            throw new Error('Paket sipariş için aktif bir yazıcı tanımlanmamış');
        }
        const tenant = await database_1.default.tenant.findUnique({ where: { id: tenantId } });
        const items = order.subChecks.flatMap(sc => sc.items
            .filter(i => i.status !== 'CANCELLED')
            .map(i => ({ name: i.menuItemName, quantity: i.quantity, price: i.totalPrice, notes: i.notes || undefined })));
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
            paymentMethod: paymentMethod || order.paymentMethod || null,
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
        const { getIO } = await Promise.resolve().then(() => __importStar(require('../../websocket/socket.server')));
        const io = getIO();
        io.to(`tenant:${tenantId}`).emit('print:bill', printJob);
        logger_1.logger.info(`📦 Paket print job sent: ${printJob.jobId} → ${printJob.printer}`);
        return new Promise((resolve) => {
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
            this.printJobEmitter.once(`result:${printJob.jobId}`, (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    resolve({ jobId: printJob.jobId, printer: printJob.printer, tenantSettings: tenantSettingsRaw });
                }
                else {
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
    async printItemUpdate(tenantId, orderId, itemId, updateType) {
        const order = await database_1.default.order.findFirst({
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
        if (!order)
            return null;
        const activeItems = order.subChecks.flatMap((subCheck) => subCheck.items);
        const item = activeItems.find(i => i.id === itemId);
        if (!item)
            return null;
        const currentMenuItem = await database_1.default.menuItem.findUnique({
            where: { id: item.menuItemId },
            select: { department: true, category: { select: { name: true } } }
        });
        const effectiveDepartment = (0, department_routing_1.resolvePreparationDepartment)(currentMenuItem?.department || item.department, currentMenuItem?.category?.name);
        let station = null;
        if (department_routing_1.KITCHEN_STATION_DEPARTMENTS.has(effectiveDepartment))
            station = 'KITCHEN';
        else if (department_routing_1.GRILL_STATION_DEPARTMENTS.has(effectiveDepartment))
            station = 'GRILL';
        if (!station)
            return null;
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
    async _printToStation(tenantId, orderId, department, itemIds, options) {
        // 1. Siparişi DB'den çek
        const order = await database_1.default.order.findFirst({
            where: { id: orderId, tenantId, isDeleted: false },
            include: {
                subChecks: { include: { items: true } },
                table: true,
                waiter: { select: { name: true } },
            },
        });
        if (!order)
            throw new Error('Sipariş bulunamadı');
        const orderItems = order.subChecks.flatMap((subCheck) => subCheck.items);
        const currentMenuItems = await database_1.default.menuItem.findMany({
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
        let dbPrinter = await database_1.default.printerConfig.findFirst({
            where: { tenantId, isActive: true, departments: { has: department } },
        });
        // Fallback: isim içinde "Fır" veya "Izgara" geçen yazıcıya bak
        if (!dbPrinter) {
            const namePart = department === 'KITCHEN' ? 'Fır' : 'Izgara';
            dbPrinter = await database_1.default.printerConfig.findFirst({
                where: { tenantId, isActive: true, name: { contains: namePart, mode: 'insensitive' } },
            });
        }
        // Use the authoritative shared constant — no DB intersection, no fallback ambiguity.
        // KITCHEN station prints: KITCHEN + COLD + PASTRY items
        // GRILL   station prints: GRILL items only
        // BAR items are NEVER sent to any station (appear only on the adisyon).
        const allowedDepartments = department === 'KITCHEN'
            ? department_routing_1.KITCHEN_STATION_DEPARTMENTS
            : department_routing_1.GRILL_STATION_DEPARTMENTS;
        const selectedItemIds = itemIds?.length ? new Set(itemIds) : null;
        const items = order.subChecks.flatMap(sc => sc.items
            .filter(item => {
            const currentMenuItem = currentMenuItemMap.get(item.menuItemId);
            const effectiveDepartment = (0, department_routing_1.resolvePreparationDepartment)(currentMenuItem?.department || item.department, currentMenuItem?.category.name);
            const statusMatch = options?.isCancel
                ? item.status === 'CANCELLED'
                : item.status !== 'CANCELLED';
            return statusMatch
                && allowedDepartments.has(effectiveDepartment)
                && (!selectedItemIds || selectedItemIds.has(item.id));
        })
            .map(item => ({
            menuItemName: item.menuItemName,
            quantity: item.quantity,
            price: item.quantity > 0 ? item.totalPrice / item.quantity : item.totalPrice,
            portionOption: item.portionOption || 'Normal',
            notes: item.notes || null,
            isCancel: options?.isCancel,
            isTreat: options?.isTreat || item.isTreat,
        })));
        if (items.length === 0) {
            throw Object.assign(new Error('Bu istasyon için yazdırılacak aktif ürün yok'), { statusCode: 422 });
        }
        // 4. IP / Port — yalnizca DB'den. Sabit adrese dusme YOK: '192.168.1.203'
        //    her restoranin agindaki farkli bir cihazdir. Yanlis mutfaga fis
        //    basmaktansa anlasilir bir hata vermek dogru davranistir.
        if (!dbPrinter?.ipAddress) {
            throw Object.assign(new Error(`${department} istasyonu için yazıcı IP adresi tanımlı değil. ` +
                'Ayarlar > Yazıcılar bölümünden yazıcıyı ekleyin.'), { statusCode: 422 });
        }
        const printerIp = dbPrinter.ipAddress;
        const printerPort = dbPrinter.port || 9100;
        const printerName = dbPrinter.name;
        // 5. Tenant'ın özel çıktı tasarım ayarlarını çek
        const tenant = await database_1.default.tenant.findUnique({ where: { id: tenantId } });
        const tenantSettings = readTenantSettings(tenant?.settings);
        const fallbackLayoutKey = department === 'KITCHEN' ? 'KITCHEN' : 'GRILL';
        const { layoutKey, layout: savedLayout } = resolveLayout(tenantSettings, dbPrinter?.id, fallbackLayoutKey);
        const layout = normalizeLayout(savedLayout, layoutKey, tenant?.name || 'REST_OTM');
        if (options?.isCancel) {
            layout.receiptTitle = 'İPTAL FİŞİ';
            layout.isCancel = true;
        }
        else if (options?.isTreat) {
            layout.receiptTitle = 'İKRAM FİŞİ';
            layout.isTreat = true;
        }
        // DEBUG: Tenant layout değerlerini logla
        logger_1.logger.info(`🎨 [${department}] ${layoutKey} template selected for ${printerName}`);
        // 6. Print job oluştur ve WebSocket üzerinden yayınla
        const printJob = {
            jobId: `${department.toLowerCase()}-${order.id}-${Date.now()}`,
            department,
            ipAddress: printerIp,
            port: printerPort,
            orderNumber: order.orderNumber,
            tableNumber: order.table?.number || 0,
            waiterName: order.waiter?.name || '',
            items,
            // Özel tasarım ayarları — print agent bu bilgiyle fişi özelleştirir
            layout,
            // Frontend fallback için tam sipariş verisi
            orderData: {
                id: order.id,
                orderNumber: order.orderNumber,
                grandTotal: order.grandTotal,
                table: order.table,
                waiter: order.waiter,
                subChecks: order.subChecks,
            },
        };
        const { getIO } = await Promise.resolve().then(() => __importStar(require('../../websocket/socket.server')));
        const io = getIO();
        io.to(`tenant:${tenantId}`).emit('print:kitchen', printJob);
        logger_1.logger.info(`🍳 ${department} print job: ${printJob.jobId} → ${printerName} (${printerIp}:${printerPort}) | `
            + `${items.map((item) => `${item.quantity}x ${item.menuItemName}`).join(', ')}`);
        // Fire-and-forget: 3 saniye bekle — sonuç gelmezse HATA ATMAZ, "queued" döner
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.printJobEmitter.removeAllListeners(`result:${printJob.jobId}`);
                logger_1.logger.warn(`⚠️  ${printerName} (${printerIp}:${printerPort}) yanıt vermedi`);
                resolve({
                    jobId: printJob.jobId,
                    printer: printerName,
                    ip: printerIp,
                    port: printerPort,
                    queued: true, // ← frontend'e "browser'dan bas" sinyali
                    error: 'Yazıcı agentı veya seçilen yazıcı yanıt vermedi.',
                    orderData: printJob.orderData,
                    department,
                    tenantSettings: tenantSettings,
                });
            }, 8000);
            this.printJobEmitter.once(`result:${printJob.jobId}`, (data) => {
                clearTimeout(timeout);
                if (data.success) {
                    // Print agent başarıyla yazdırdı
                    resolve({ jobId: printJob.jobId, printer: printerName, ip: printerIp, port: printerPort, tenantSettings: tenantSettings });
                }
                else {
                    // Print agent bağlandı ama yazıcı hatası → frontend fallback
                    logger_1.logger.error(`❌ ${printerName} yazdırma hatası: ${data.error}`);
                    resolve({
                        jobId: printJob.jobId,
                        printer: printerName,
                        ip: printerIp,
                        port: printerPort,
                        queued: true,
                        error: data.error || 'Yazıcıya gönderilemedi.',
                        orderData: printJob.orderData,
                        department,
                        tenantSettings: tenantSettings,
                    });
                }
            });
        });
    },
};
//# sourceMappingURL=print.service.js.map