import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { getTenantId } from '../../middlewares/tenant.middleware';
import { cmsService } from './cms.service';
import { apiResponse } from '../../utils/apiResponse';

export const cmsController = {
  // ─── Gallery ─────────────────────────
  async getGallery(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const gallery = await cmsService.getGallery(tenantId);
      apiResponse({ res, data: gallery });
    } catch (error) { next(error); }
  },

  async createGalleryImage(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const image = await cmsService.createGalleryImage(tenantId, req.body);
      apiResponse({ res, statusCode: 201, data: image, message: 'Gallery image created' });
    } catch (error) { next(error); }
  },

  async updateGalleryImage(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const image = await cmsService.updateGalleryImage(tenantId, ((req.params.id as string)), req.body);
      apiResponse({ res, data: image, message: 'Gallery image updated' });
    } catch (error) { next(error); }
  },

  async deleteGalleryImage(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      await cmsService.deleteGalleryImage(tenantId, ((req.params.id as string)));
      apiResponse({ res, message: 'Gallery image deleted' });
    } catch (error) { next(error); }
  },

  // ─── Stories ─────────────────────────
  async getStories(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const stories = await cmsService.getStories(tenantId);
      apiResponse({ res, data: stories });
    } catch (error) { next(error); }
  },

  async createStory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const story = await cmsService.createStory(tenantId, req.body);
      apiResponse({ res, statusCode: 201, data: story, message: 'Story created' });
    } catch (error) { next(error); }
  },

  async updateStory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const story = await cmsService.updateStory(tenantId, ((req.params.id as string)), req.body);
      apiResponse({ res, data: story, message: 'Story updated' });
    } catch (error) { next(error); }
  },

  async deleteStory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      await cmsService.deleteStory(tenantId, ((req.params.id as string)));
      apiResponse({ res, message: 'Story deleted' });
    } catch (error) { next(error); }
  },

  // ─── Settings ─────────────────────────
  async getSettings(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const settings = await cmsService.getSettings(tenantId);
      apiResponse({ res, data: settings });
    } catch (error) { next(error); }
  },

  async updateSettings(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const settings = await cmsService.updateSettings(tenantId, req.body);
      apiResponse({ res, data: settings, message: 'Settings updated' });
    } catch (error) { next(error); }
  },

  // ─── Reviews ─────────────────────────
  async getReviews(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const reviews = await cmsService.getReviews(tenantId);
      apiResponse({ res, data: reviews });
    } catch (error) { next(error); }
  },

  async createReview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const review = await cmsService.createReview(tenantId, req.body);
      apiResponse({ res, statusCode: 201, data: review, message: 'Review created' });
    } catch (error) { next(error); }
  },

  async updateReview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const review = await cmsService.updateReview(tenantId, ((req.params.id as string)), req.body);
      apiResponse({ res, data: review, message: 'Review updated' });
    } catch (error) { next(error); }
  },

  async deleteReview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      await cmsService.deleteReview(tenantId, ((req.params.id as string)));
      apiResponse({ res, message: 'Review deleted' });
    } catch (error) { next(error); }
  },
};
