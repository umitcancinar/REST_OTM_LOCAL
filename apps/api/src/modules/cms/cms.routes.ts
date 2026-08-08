import { Router } from 'express';
import { cmsController } from './cms.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { tenantMiddleware } from '../../middlewares/tenant.middleware';
import { minRole } from '../../middlewares/rbac.middleware';
import { checkFeature } from '../../middlewares/feature.middleware';

const router = Router();

// Protected routes
router.use(authMiddleware);
router.use(tenantMiddleware);
router.use(checkFeature('website'));

// Gallery
router.get('/gallery', cmsController.getGallery);
router.post('/gallery', minRole('OWNER'), cmsController.createGalleryImage);
router.patch('/gallery/:id', minRole('OWNER'), cmsController.updateGalleryImage);
router.delete('/gallery/:id', minRole('OWNER'), cmsController.deleteGalleryImage);

// Stories
router.get('/stories', cmsController.getStories);
router.post('/stories', minRole('OWNER'), cmsController.createStory);
router.patch('/stories/:id', minRole('OWNER'), cmsController.updateStory);
router.delete('/stories/:id', minRole('OWNER'), cmsController.deleteStory);

// Settings
router.get('/settings', cmsController.getSettings);
router.patch('/settings', minRole('OWNER'), cmsController.updateSettings);

// Reviews
router.get('/reviews', cmsController.getReviews);
router.post('/reviews', minRole('OWNER'), cmsController.createReview);
router.patch('/reviews/:id', minRole('OWNER'), cmsController.updateReview);
router.delete('/reviews/:id', minRole('OWNER'), cmsController.deleteReview);

export default router;
