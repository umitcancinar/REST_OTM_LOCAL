"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const cms_controller_1 = require("./cms.controller");
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const rbac_middleware_1 = require("../../middlewares/rbac.middleware");
const feature_middleware_1 = require("../../middlewares/feature.middleware");
const router = (0, express_1.Router)();
// Protected routes
router.use(auth_middleware_1.authMiddleware);
router.use(tenant_middleware_1.tenantMiddleware);
router.use((0, feature_middleware_1.checkFeature)('website'));
// Gallery
router.get('/gallery', cms_controller_1.cmsController.getGallery);
router.post('/gallery', (0, rbac_middleware_1.minRole)('OWNER'), cms_controller_1.cmsController.createGalleryImage);
router.patch('/gallery/:id', (0, rbac_middleware_1.minRole)('OWNER'), cms_controller_1.cmsController.updateGalleryImage);
router.delete('/gallery/:id', (0, rbac_middleware_1.minRole)('OWNER'), cms_controller_1.cmsController.deleteGalleryImage);
// Stories
router.get('/stories', cms_controller_1.cmsController.getStories);
router.post('/stories', (0, rbac_middleware_1.minRole)('OWNER'), cms_controller_1.cmsController.createStory);
router.patch('/stories/:id', (0, rbac_middleware_1.minRole)('OWNER'), cms_controller_1.cmsController.updateStory);
router.delete('/stories/:id', (0, rbac_middleware_1.minRole)('OWNER'), cms_controller_1.cmsController.deleteStory);
// Settings
router.get('/settings', cms_controller_1.cmsController.getSettings);
router.patch('/settings', (0, rbac_middleware_1.minRole)('OWNER'), cms_controller_1.cmsController.updateSettings);
// Reviews
router.get('/reviews', cms_controller_1.cmsController.getReviews);
router.post('/reviews', (0, rbac_middleware_1.minRole)('OWNER'), cms_controller_1.cmsController.createReview);
router.patch('/reviews/:id', (0, rbac_middleware_1.minRole)('OWNER'), cms_controller_1.cmsController.updateReview);
router.delete('/reviews/:id', (0, rbac_middleware_1.minRole)('OWNER'), cms_controller_1.cmsController.deleteReview);
exports.default = router;
//# sourceMappingURL=cms.routes.js.map