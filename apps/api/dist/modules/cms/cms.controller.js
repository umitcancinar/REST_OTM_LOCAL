"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmsController = void 0;
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const cms_service_1 = require("./cms.service");
const apiResponse_1 = require("../../utils/apiResponse");
exports.cmsController = {
    // ─── Gallery ─────────────────────────
    async getGallery(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const gallery = await cms_service_1.cmsService.getGallery(tenantId);
            (0, apiResponse_1.apiResponse)({ res, data: gallery });
        }
        catch (error) {
            next(error);
        }
    },
    async createGalleryImage(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const image = await cms_service_1.cmsService.createGalleryImage(tenantId, req.body);
            (0, apiResponse_1.apiResponse)({ res, statusCode: 201, data: image, message: 'Gallery image created' });
        }
        catch (error) {
            next(error);
        }
    },
    async updateGalleryImage(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const image = await cms_service_1.cmsService.updateGalleryImage(tenantId, req.params.id, req.body);
            (0, apiResponse_1.apiResponse)({ res, data: image, message: 'Gallery image updated' });
        }
        catch (error) {
            next(error);
        }
    },
    async deleteGalleryImage(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            await cms_service_1.cmsService.deleteGalleryImage(tenantId, req.params.id);
            (0, apiResponse_1.apiResponse)({ res, message: 'Gallery image deleted' });
        }
        catch (error) {
            next(error);
        }
    },
    // ─── Stories ─────────────────────────
    async getStories(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const stories = await cms_service_1.cmsService.getStories(tenantId);
            (0, apiResponse_1.apiResponse)({ res, data: stories });
        }
        catch (error) {
            next(error);
        }
    },
    async createStory(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const story = await cms_service_1.cmsService.createStory(tenantId, req.body);
            (0, apiResponse_1.apiResponse)({ res, statusCode: 201, data: story, message: 'Story created' });
        }
        catch (error) {
            next(error);
        }
    },
    async updateStory(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const story = await cms_service_1.cmsService.updateStory(tenantId, req.params.id, req.body);
            (0, apiResponse_1.apiResponse)({ res, data: story, message: 'Story updated' });
        }
        catch (error) {
            next(error);
        }
    },
    async deleteStory(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            await cms_service_1.cmsService.deleteStory(tenantId, req.params.id);
            (0, apiResponse_1.apiResponse)({ res, message: 'Story deleted' });
        }
        catch (error) {
            next(error);
        }
    },
    // ─── Settings ─────────────────────────
    async getSettings(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const settings = await cms_service_1.cmsService.getSettings(tenantId);
            (0, apiResponse_1.apiResponse)({ res, data: settings });
        }
        catch (error) {
            next(error);
        }
    },
    async updateSettings(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const settings = await cms_service_1.cmsService.updateSettings(tenantId, req.body);
            (0, apiResponse_1.apiResponse)({ res, data: settings, message: 'Settings updated' });
        }
        catch (error) {
            next(error);
        }
    },
    // ─── Reviews ─────────────────────────
    async getReviews(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const reviews = await cms_service_1.cmsService.getReviews(tenantId);
            (0, apiResponse_1.apiResponse)({ res, data: reviews });
        }
        catch (error) {
            next(error);
        }
    },
    async createReview(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const review = await cms_service_1.cmsService.createReview(tenantId, req.body);
            (0, apiResponse_1.apiResponse)({ res, statusCode: 201, data: review, message: 'Review created' });
        }
        catch (error) {
            next(error);
        }
    },
    async updateReview(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            const review = await cms_service_1.cmsService.updateReview(tenantId, req.params.id, req.body);
            (0, apiResponse_1.apiResponse)({ res, data: review, message: 'Review updated' });
        }
        catch (error) {
            next(error);
        }
    },
    async deleteReview(req, res, next) {
        try {
            const tenantId = (0, tenant_middleware_1.getTenantId)(req);
            await cms_service_1.cmsService.deleteReview(tenantId, req.params.id);
            (0, apiResponse_1.apiResponse)({ res, message: 'Review deleted' });
        }
        catch (error) {
            next(error);
        }
    },
};
//# sourceMappingURL=cms.controller.js.map