"use strict";
// ==========================================
// Lisans Controller
// ==========================================
// Bu uc noktalar musterinin bilgisayarindan cagrilir; kimlik dogrulamasi
// yoktur. Yetkilendirmenin yerini lisans anahtari + donanim baglamasi tutar.
Object.defineProperty(exports, "__esModule", { value: true });
exports.licenseController = void 0;
const license_service_1 = require("./license.service");
const license_validation_1 = require("./license.validation");
const apiResponse_1 = require("../../utils/apiResponse");
/** Hatalari tek yerde ele al — her handler'da tekrar etmeyelim. */
function handle(res, next, error) {
    const err = error;
    if (err.statusCode) {
        (0, apiResponse_1.apiError)(res, err.statusCode, err.message);
        return;
    }
    next(error);
}
exports.licenseController = {
    /** POST /api/license/activate — ilk kurulumda bir kez. */
    async activate(req, res, next) {
        try {
            const input = license_validation_1.activateSchema.parse(req.body);
            const result = await license_service_1.licenseService.activate({ ...input, ip: req.ip });
            (0, apiResponse_1.apiResponse)({ res, data: result, message: 'Lisans etkinleştirildi' });
        }
        catch (error) {
            handle(res, next, error);
        }
    },
    /** POST /api/license/heartbeat — lokal taraf saatte bir cagirir. */
    async heartbeat(req, res, next) {
        try {
            const input = license_validation_1.heartbeatSchema.parse(req.body);
            const result = await license_service_1.licenseService.heartbeat({ ...input, ip: req.ip });
            (0, apiResponse_1.apiResponse)({ res, data: result, message: 'Yoklama alındı' });
        }
        catch (error) {
            handle(res, next, error);
        }
    },
};
//# sourceMappingURL=license.controller.js.map