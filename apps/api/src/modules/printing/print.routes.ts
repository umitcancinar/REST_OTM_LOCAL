// ==========================================
// Print Routes
// ==========================================

import { Router } from 'express';
import { printController } from './print.controller';
import { authMiddleware, type AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';
import { minRole, rbac } from '../../middlewares/rbac.middleware';
import rateLimit from 'express-rate-limit';

const router = Router();

router.use(authMiddleware);
router.use(tenantMiddleware);

const operationsAccess = rbac('ADMIN', 'OWNER');
const operationRateKey = (req: AuthenticatedRequest) =>
  `${req.user?.tenantId || 'missing-tenant'}:${req.user?.userId || 'missing-user'}`;
const operationsReadLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: operationRateKey,
  message: { success: false, message: 'Print operasyon sorgu limiti aşıldı.' },
});
const reprintLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: operationRateKey,
  message: { success: false, message: 'Yeniden baskı komut limiti aşıldı.' },
});
const discoveryLimiter = rateLimit({
  windowMs: 60_000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: operationRateKey,
  message: { success: false, message: 'Yazıcı taraması kısa süre içinde çok fazla çalıştırıldı.' },
});

// Yazıcı yönetimi — ayarlar ekranına erişebilen ADMIN ve OWNER
router.get('/', printController.getPrinters);
router.get('/status', operationsAccess, operationsReadLimiter, printController.getStatus);
router.get('/discover', operationsAccess, discoveryLimiter, printController.discoverPrinters);
router.get('/jobs/summary', operationsAccess, operationsReadLimiter, printController.getOperationsSummary);
router.get('/jobs', operationsAccess, operationsReadLimiter, printController.getJobs);
router.get('/jobs/:id', operationsAccess, operationsReadLimiter, printController.getJob);
router.post('/jobs/:id/reprint', operationsAccess, reprintLimiter, printController.reprintJob);
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
