import { Router } from 'express';
import { publicCloudController as publicController } from './public-cloud.controller';

const router = Router();

/**
 * ─── GENERAL TENANT INFO ───────────────────────────
 */
router.get('/tenant', publicController.getTenantInfo);

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
