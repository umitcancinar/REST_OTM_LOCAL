// ==========================================
// Lisans Rotalari
// ==========================================
// Her iki uc nokta da KIMLIK DOGRULAMASIZ: musterinin bilgisayari henuz
// bir kullanici olarak giris yapmis degil, elinde yalnizca lisans anahtari
// var. Bu yuzden hiz sinirlamasi burada guvenlik onlemidir, konfor degil:
// anahtar denemesiyle gecerli lisans bulma girisimini engeller.

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { licenseController } from './license.controller';

const router = Router();

/**
 * Aktivasyon nadiren cagrilir (kurulumda bir kez). Siki sinir, anahtar
 * tahmin etme denemelerini pratikte imkansiz kilar.
 */
const activateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin.' },
});

/**
 * Yoklama saatte bir gelir. Sinir bunun uzerinde tutuluyor: yeniden
 * baslatmalar ve tekrar denemeler mesru sekilde birkac fazladan istek
 * uretebilir, mesru musteriyi kilitlemek istemeyiz.
 */
const heartbeatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Çok fazla istek. Lütfen daha sonra tekrar deneyin.' },
});

router.post('/activate', activateLimiter, licenseController.activate);
router.post('/heartbeat', heartbeatLimiter, licenseController.heartbeat);

export default router;
