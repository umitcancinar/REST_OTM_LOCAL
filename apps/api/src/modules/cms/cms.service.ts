import { prisma } from '../../config/database';

export const cmsService = {
  // Gallery
  async getGallery(tenantId: string) {
    return prisma.galleryImage.findMany({
      where: { tenantId },
      orderBy: { sortOrder: 'asc' },
    });
  },
  async createGalleryImage(tenantId: string, data: any) {
    return prisma.galleryImage.create({
      data: { ...data, tenantId },
    });
  },
  async updateGalleryImage(tenantId: string, id: string, data: any) {
    return prisma.galleryImage.update({
      where: { id_tenantId: { id, tenantId } },
      data,
    });
  },
  async deleteGalleryImage(tenantId: string, id: string) {
    return prisma.galleryImage.delete({
      where: { id_tenantId: { id, tenantId } },
    });
  },

  // Stories
  async getStories(tenantId: string) {
    return prisma.story.findMany({
      where: { tenantId },
      orderBy: { sortOrder: 'asc' },
    });
  },
  async createStory(tenantId: string, data: any) {
    return prisma.story.create({
      data: { ...data, tenantId },
    });
  },
  async updateStory(tenantId: string, id: string, data: any) {
    return prisma.story.update({
      where: { id_tenantId: { id, tenantId } },
      data,
    });
  },
  async deleteStory(tenantId: string, id: string) {
    return prisma.story.delete({
      where: { id_tenantId: { id, tenantId } },
    });
  },

  // Settings
  async getSettings(tenantId: string) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    return tenant?.settings || {};
  },
  async updateSettings(tenantId: string, newSettings: any) {
    const current = await this.getSettings(tenantId);
    return prisma.tenant.update({
      where: { id: tenantId },
      data: { 
        settings: {
          ...(current as object),
          ...newSettings
        }
      },
      select: { settings: true },
    });
  },

  // Reviews
  async getReviews(tenantId: string) {
    return prisma.review.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  },
  async createReview(tenantId: string, data: any) {
    return prisma.review.create({
      data: { ...data, tenantId },
    });
  },
  async updateReview(tenantId: string, id: string, data: any) {
    return prisma.review.update({
      where: { id_tenantId: { id, tenantId } },
      data,
    });
  },
  async deleteReview(tenantId: string, id: string) {
    return prisma.review.delete({
      where: { id_tenantId: { id, tenantId } },
    });
  },
};
