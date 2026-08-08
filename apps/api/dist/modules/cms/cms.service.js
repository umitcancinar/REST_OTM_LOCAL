"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmsService = void 0;
const database_1 = require("../../config/database");
exports.cmsService = {
    // Gallery
    async getGallery(tenantId) {
        return database_1.prisma.galleryImage.findMany({
            where: { tenantId },
            orderBy: { sortOrder: 'asc' },
        });
    },
    async createGalleryImage(tenantId, data) {
        return database_1.prisma.galleryImage.create({
            data: { ...data, tenantId },
        });
    },
    async updateGalleryImage(tenantId, id, data) {
        return database_1.prisma.galleryImage.update({
            where: { id_tenantId: { id, tenantId } },
            data,
        });
    },
    async deleteGalleryImage(tenantId, id) {
        return database_1.prisma.galleryImage.delete({
            where: { id_tenantId: { id, tenantId } },
        });
    },
    // Stories
    async getStories(tenantId) {
        return database_1.prisma.story.findMany({
            where: { tenantId },
            orderBy: { sortOrder: 'asc' },
        });
    },
    async createStory(tenantId, data) {
        return database_1.prisma.story.create({
            data: { ...data, tenantId },
        });
    },
    async updateStory(tenantId, id, data) {
        return database_1.prisma.story.update({
            where: { id_tenantId: { id, tenantId } },
            data,
        });
    },
    async deleteStory(tenantId, id) {
        return database_1.prisma.story.delete({
            where: { id_tenantId: { id, tenantId } },
        });
    },
    // Settings
    async getSettings(tenantId) {
        const tenant = await database_1.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        return tenant?.settings || {};
    },
    async updateSettings(tenantId, newSettings) {
        const current = await this.getSettings(tenantId);
        return database_1.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                settings: {
                    ...current,
                    ...newSettings
                }
            },
            select: { settings: true },
        });
    },
    // Reviews
    async getReviews(tenantId) {
        return database_1.prisma.review.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
        });
    },
    async createReview(tenantId, data) {
        return database_1.prisma.review.create({
            data: { ...data, tenantId },
        });
    },
    async updateReview(tenantId, id, data) {
        return database_1.prisma.review.update({
            where: { id_tenantId: { id, tenantId } },
            data,
        });
    },
    async deleteReview(tenantId, id) {
        return database_1.prisma.review.delete({
            where: { id_tenantId: { id, tenantId } },
        });
    },
};
//# sourceMappingURL=cms.service.js.map