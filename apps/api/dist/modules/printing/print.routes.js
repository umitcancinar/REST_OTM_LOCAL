"use strict";
// ==========================================
// Print Routes
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const print_controller_1 = require("./print.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
router.use(tenant_middleware_1.tenantMiddleware);
// Yazıcı yönetimi — ayarlar ekranına erişebilen ADMIN ve OWNER
router.get('/', print_controller_1.printController.getPrinters);
router.get('/status', print_controller_1.printController.getStatus);
router.post('/', (0, rbac_middleware_1.minRole)('ADMIN'), print_controller_1.printController.createPrinter);
router.post('/:id/test', (0, rbac_middleware_1.minRole)('ADMIN'), print_controller_1.printController.testPrinter);
router.post('/:id/calibrate', (0, rbac_middleware_1.minRole)('ADMIN'), print_controller_1.printController.calibratePrinter);
router.patch('/:id', (0, rbac_middleware_1.minRole)('ADMIN'), print_controller_1.printController.updatePrinter);
router.delete('/:id', (0, rbac_middleware_1.minRole)('ADMIN'), print_controller_1.printController.deletePrinter);
// Yazdırma endpoint'leri — tüm yetkili kullanıcılar
router.post('/print-kitchen', print_controller_1.printController.printKitchen); // Fırın → 192.168.1.203
router.post('/print-grill', print_controller_1.printController.printGrill); // Izgara → 192.168.1.202
router.post('/print-stations', print_controller_1.printController.printProductionStations); // Otomatik Fırın + Izgara ayrımı
router.post('/print-paket', print_controller_1.printController.printPaket); // Paket
router.post('/print-bill', print_controller_1.printController.printBill); // Adisyon (altyapı hazır)
// Z raporu (gün sonu özeti) — ciro verisi içerdiği için ADMIN ve üstü
router.post('/print-zreport', (0, rbac_middleware_1.minRole)('ADMIN'), print_controller_1.printController.printZReport);
exports.default = router;
//# sourceMappingURL=print.routes.js.map