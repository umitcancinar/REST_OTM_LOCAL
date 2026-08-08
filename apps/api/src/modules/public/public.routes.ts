import { Router } from 'express';
import { publicController } from './public.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { rbac } from '../../middlewares/rbac.middleware';

const router = Router();

/**
 * ─── GENERAL TENANT INFO ───────────────────────────
 */
router.get('/tenant', publicController.getTenantInfo);

// GUVENLIK: Once kimlik dogrulamasi olmadan TUM kiracilarin masalarini
// tek istekte degistirebiliyordu. Artik SUPER_ADMIN + POST + tek tenantId
// zorunlu. Bkz. raporlar/02_GUVENLIK_RAPORU.md madde G-01 (kritik).
router.post('/fix-tables', authMiddleware, rbac('SUPER_ADMIN'), publicController.fixTables);

// Musteri menu uygulamasindan garson cagirma (kimlik dogrulama gerekmez,
// masanin tenant'a ait oldugu controller icinde dogrulanir).
router.post('/waiter/call/:slug', publicController.callWaiter);

/**
 * ─── MENU ──────────────────────────────────────────
 */
router.get('/menu/:slug', publicController.getMenuBySlug);
router.get('/menu', publicController.getMenu); // Legacy support

/**
 * ─── CMS CONTENT (PUBLIC) ──────────────────────────
 */
router.get('/cms/settings/:slug', publicController.getCmsSettings);
router.get('/cms/gallery/:slug', publicController.getGallery);
router.get('/cms/stories/:slug', publicController.getStories);
router.get('/cms/reviews/:slug', publicController.getReviews);
router.get('/cms/reservations/:slug', publicController.getReservations);
router.get('/cms/tablemap/:slug', publicController.getTableMap);
router.get('/cms/navlinks/:slug', publicController.getNavLinks);

export default router;
