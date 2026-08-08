import { Router } from 'express';
import { callLocalWaiter } from './local-waiter-call.controller';

const router = Router();

// Bu LAN aksiyonu cloud public projection'a dahil edilmez. QR menu veya masa
// terminali dogrudan isletmenin local gateway adresine istek gonderir.
router.post('/waiter/call/:slug', callLocalWaiter);

export default router;
