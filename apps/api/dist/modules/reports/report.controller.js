"use strict";
// ==========================================
// Report Controller
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportController = void 0;
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const report_service_1 = require("./report.service");
const apiResponse_1 = require("../../utils/apiResponse");
exports.reportController = {
    async getDailySummary(req, res, next) {
        try {
            const startDate = req.query.startDate || req.query.date || new Date().toISOString().split('T')[0];
            const endDate = req.query.endDate || req.query.date || new Date().toISOString().split('T')[0];
            const summary = await report_service_1.reportService.getSummaryInRange((0, tenant_middleware_1.getTenantId)(req), startDate, endDate);
            (0, apiResponse_1.apiResponse)({ res, data: summary });
        }
        catch (error) {
            next(error);
        }
    },
    async getRevenueByRange(req, res, next) {
        try {
            const { startDate, endDate } = req.query;
            const revenue = await report_service_1.reportService.getRevenueByRange((0, tenant_middleware_1.getTenantId)(req), startDate, endDate);
            (0, apiResponse_1.apiResponse)({ res, data: revenue });
        }
        catch (error) {
            next(error);
        }
    },
    async getDepartmentStats(req, res, next) {
        try {
            const date = req.query.date || new Date().toISOString().split('T')[0];
            const stats = await report_service_1.reportService.getDepartmentStats((0, tenant_middleware_1.getTenantId)(req), date);
            (0, apiResponse_1.apiResponse)({ res, data: stats });
        }
        catch (error) {
            next(error);
        }
    },
};
//# sourceMappingURL=report.controller.js.map