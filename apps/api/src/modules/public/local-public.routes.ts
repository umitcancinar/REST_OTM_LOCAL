import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createCallLocalWaiter } from './local-waiter-call.controller';
import { TableQrTokenService } from './table-qr-token.service';

export function createLocalPublicRouter(tableQrTokenService: TableQrTokenService): Router {
  const router = Router();
  const waiterCallLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 6,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Garson çağrısı sınırı aşıldı.' },
  });

  // Bu LAN aksiyonu cloud public projection'a dahil edilmez. QR menu veya masa
  // terminali dogrudan isletmenin local gateway adresine istek gonderir.
  router.post('/waiter/call/:slug', waiterCallLimiter, createCallLocalWaiter(tableQrTokenService));

  return router;
}
