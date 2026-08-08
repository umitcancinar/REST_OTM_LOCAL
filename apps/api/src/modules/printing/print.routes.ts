// ==========================================
// Print Routes
// ==========================================

import { Router } from 'express';
import { printController } from './print.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';
import { minRole } from '../../middlewares/rbac.middleware';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);

// Yazıcı yönetimi — ayarlar ekranına erişebilen ADMIN ve OWNER
router.get('/', printController.getPrinters);
router.get('/status', printController.getStatus);
router.post('/', minRole('ADMIN'), printController.createPrinter);
router.post('/:id/test', minRole('ADMIN'), printController.testPrinter);
router.post('/:id/calibrate', minRole('ADMIN'), printController.calibratePrinter);
router.patch('/:id', minRole('ADMIN'), printController.updatePrinter);
router.delete('/:id', minRole('ADMIN'), printController.deletePrinter);

// Yazdırma endpoint'leri — tüm yetkili kullanıcılar
router.post('/print-kitchen', printController.printKitchen); // Fırın → 192.168.1.203
router.post('/print-grill',   printController.printGrill);   // Izgara → 192.168.1.202
router.post('/print-stations', printController.printProductionStations); // Otomatik Fırın + Izgara ayrımı
router.post('/print-paket',   printController.printPaket);   // Paket
router.post('/print-bill',    printController.printBill);    // Adisyon (altyapı hazır)
// Z raporu (gün sonu özeti) — ciro verisi içerdiği için ADMIN ve üstü
router.post('/print-zreport', minRole('ADMIN'), printController.printZReport);

export default router;
