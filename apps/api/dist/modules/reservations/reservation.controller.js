"use strict";
// ==========================================
// Reservation Controller
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.reservationController = void 0;
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const reservation_service_1 = require("./reservation.service");
const apiResponse_1 = require("../../utils/apiResponse");
exports.reservationController = {
    async getAll(req, res, next) {
        try {
            const reservations = await reservation_service_1.reservationService.getAll((0, tenant_middleware_1.getTenantId)(req));
            (0, apiResponse_1.apiResponse)({ res, data: reservations });
        }
        catch (error) {
            next(error);
        }
    },
    async create(req, res, next) {
        try {
            const reservation = await reservation_service_1.reservationService.create((0, tenant_middleware_1.getTenantId)(req), req.body);
            (0, apiResponse_1.apiResponse)({ res, statusCode: 201, data: reservation, message: 'Rezervasyon oluşturuldu' });
        }
        catch (error) {
            next(error);
        }
    },
    async updateStatus(req, res, next) {
        try {
            const { status } = req.body;
            const reservation = await reservation_service_1.reservationService.updateStatus((0, tenant_middleware_1.getTenantId)(req), req.params.id, status);
            (0, apiResponse_1.apiResponse)({ res, data: reservation, message: 'Rezervasyon durumu güncellendi' });
        }
        catch (error) {
            next(error);
        }
    },
    async bulkDelete(req, res, next) {
        try {
            await reservation_service_1.reservationService.deleteAll((0, tenant_middleware_1.getTenantId)(req));
            (0, apiResponse_1.apiResponse)({ res, message: 'Tüm rezervasyonlar temizlendi' });
        }
        catch (error) {
            next(error);
        }
    },
    async delete(req, res, next) {
        try {
            await reservation_service_1.reservationService.delete((0, tenant_middleware_1.getTenantId)(req), req.params.id);
            (0, apiResponse_1.apiResponse)({ res, message: 'Rezervasyon silindi' });
        }
        catch (error) {
            next(error);
        }
    },
};
//# sourceMappingURL=reservation.controller.js.map