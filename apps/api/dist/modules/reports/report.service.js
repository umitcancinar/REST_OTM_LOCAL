"use strict";
// ==========================================
// Report Service — Analytics & Z-Raporu
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportService = void 0;
const database_1 = __importDefault(require("../../config/database"));
exports.reportService = {
    /** Performance summary over a date range */
    async getSummaryInRange(tenantId, start, end) {
        const startDate = new Date(start);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(end);
        endDate.setHours(23, 59, 59, 999);
        const orders = await database_1.default.order.findMany({
            where: {
                tenantId,
                createdAt: { gte: startDate, lte: endDate },
                status: { in: ['COMPLETED', 'SERVED'] },
            },
            include: {
                table: { select: { number: true, zone: true } },
                customer: true,
                waiter: { select: { id: true, name: true } },
                subChecks: { include: { items: true } },
            },
            orderBy: { createdAt: 'desc' }
        });
        const activeWaitersCount = await database_1.default.user.count({
            where: { tenantId, role: 'WAITER' }
        });
        const totalRevenue = orders.reduce((sum, o) => sum + o.grandTotal, 0);
        const totalOrders = orders.length;
        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        // Payment method breakdown. A single order can be paid with multiple
        // methods (e.g. 500 TL nakit + 1000 TL kart) — o.payments records each
        // partial payment's own method/amount, so we split the revenue by that
        // instead of attributing the whole grandTotal to o.paymentMethod (which
        // only ever holds the LAST method used). Orders completed through the
        // legacy/simple flow (no tracked partial payments) have an empty
        // payments array; any amount not covered by tracked payments falls back
        // to o.paymentMethod, so the breakdown always sums to totalRevenue.
        const paymentBreakdown = orders.reduce((acc, o) => {
            const trackedPayments = Array.isArray(o.payments)
                ? o.payments
                : [];
            let trackedSum = 0;
            for (const payment of trackedPayments) {
                const method = payment.method || 'UNKNOWN';
                const amount = Number(payment.amount) || 0;
                acc[method] = (acc[method] || 0) + amount;
                trackedSum += amount;
            }
            const remainder = o.grandTotal - trackedSum;
            if (remainder > 0.01) {
                const method = o.paymentMethod || 'UNKNOWN';
                acc[method] = (acc[method] || 0) + remainder;
            }
            return acc;
        }, {});
        // Top selling items
        const itemCounts = {};
        orders.forEach((o) => {
            o.subChecks.forEach((sc) => {
                sc.items.forEach((item) => {
                    if (!itemCounts[item.menuItemId]) {
                        itemCounts[item.menuItemId] = { name: item.menuItemName, count: 0, revenue: 0 };
                    }
                    itemCounts[item.menuItemId].count += item.quantity;
                    itemCounts[item.menuItemId].revenue += item.totalPrice;
                });
            });
        });
        const topItems = Object.values(itemCounts)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10);
        // Waiter performance
        const waiterPerformance = {};
        orders.forEach((o) => {
            const waiterId = o.waiterId || 'unassigned';
            const waiterName = o.waiter?.name || 'Atanmamış';
            if (!waiterPerformance[waiterId]) {
                waiterPerformance[waiterId] = { name: waiterName, orders: 0, revenue: 0 };
            }
            waiterPerformance[waiterId].orders += 1;
            waiterPerformance[waiterId].revenue += o.grandTotal;
        });
        return {
            startDate: start,
            endDate: end,
            totalRevenue,
            totalOrders,
            avgOrderValue,
            paymentBreakdown,
            topSellingItems: topItems,
            waiterPerformance: Object.values(waiterPerformance).sort((a, b) => b.revenue - a.revenue),
            activeWaitersCount,
            recentOrders: orders,
        };
    },
    /** Revenue over a date range (for charts) */
    async getRevenueByRange(tenantId, startDate, endDate) {
        const orders = await database_1.default.order.findMany({
            where: {
                tenantId,
                createdAt: { gte: new Date(startDate), lte: new Date(endDate) },
                status: { in: ['COMPLETED', 'SERVED'] },
            },
            select: { grandTotal: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
        });
        // Group by date
        const dailyRevenue = {};
        orders.forEach((o) => {
            const day = o.createdAt.toISOString().split('T')[0];
            dailyRevenue[day] = (dailyRevenue[day] || 0) + o.grandTotal;
        });
        return Object.entries(dailyRevenue).map(([date, revenue]) => ({
            date,
            revenue,
        }));
    },
    /** Department-based analytics */
    async getDepartmentStats(tenantId, date) {
        const startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);
        const items = await database_1.default.orderItem.findMany({
            where: {
                subCheck: {
                    order: {
                        tenantId,
                        createdAt: { gte: startDate, lte: endDate },
                    },
                },
            },
            select: {
                department: true,
                totalPrice: true,
                quantity: true,
            },
        });
        const stats = {};
        items.forEach((item) => {
            if (!stats[item.department]) {
                stats[item.department] = { count: 0, revenue: 0 };
            }
            stats[item.department].count += item.quantity;
            stats[item.department].revenue += item.totalPrice;
        });
        return stats;
    },
};
//# sourceMappingURL=report.service.js.map