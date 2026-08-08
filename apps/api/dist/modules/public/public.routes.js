"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const public_controller_1 = require("./public.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const router = (0, express_1.Router)();
/**
 * ─── GENERAL TENANT INFO ───────────────────────────
 */
router.get('/tenant', public_controller_1.publicController.getTenantInfo);
// GUVENLIK: Once kimlik dogrulamasi olmadan TUM kiracilarin masalarini
// tek istekte degistirebiliyordu. Artik SUPER_ADMIN + POST + tek tenantId
// zorunlu. Bkz. raporlar/02_GUVENLIK_RAPORU.md madde G-01 (kritik).
router.post('/fix-tables', auth_middleware_1.authMiddleware, (0, rbac_middleware_1.rbac)('SUPER_ADMIN'), public_controller_1.publicController.fixTables);
// Musteri menu uygulamasindan garson cagirma (kimlik dogrulama gerekmez,
// masanin tenant'a ait oldugu controller icinde dogrulanir).
router.post('/waiter/call/:slug', public_controller_1.publicController.callWaiter);
/**
 * ─── MENU ──────────────────────────────────────────
 */
router.get('/menu/:slug', public_controller_1.publicController.getMenuBySlug);
router.get('/menu', public_controller_1.publicController.getMenu); // Legacy support
/**
 * ─── CMS CONTENT (PUBLIC) ──────────────────────────
 */
router.get('/cms/settings/:slug', public_controller_1.publicController.getCmsSettings);
router.get('/cms/gallery/:slug', public_controller_1.publicController.getGallery);
router.get('/cms/stories/:slug', public_controller_1.publicController.getStories);
router.get('/cms/reviews/:slug', public_controller_1.publicController.getReviews);
router.get('/cms/reservations/:slug', public_controller_1.publicController.getReservations);
router.get('/cms/tablemap/:slug', public_controller_1.publicController.getTableMap);
router.get('/cms/navlinks/:slug', public_controller_1.publicController.getNavLinks);
exports.default = router;
//# sourceMappingURL=public.routes.js.map