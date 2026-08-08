import { prisma } from '../../config/database';
import {
  enqueueMenuProjection,
  kickMenuProjectionOutbox,
} from '../menu-projection/menu-projection.service';

export const cmsService = {
  // Gallery
  async getGallery(tenantId: string) {
    return prisma.galleryImage.findMany({
      where: { tenantId },
      orderBy: { sortOrder: 'asc' },
    });
  },
  async createGalleryImage(tenantId: string, data: any) {
    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.galleryImage.create({ data: { ...data, tenantId } });
      await enqueueMenuProjection(tx, tenantId);
      return created;
    });
    kickMenuProjectionOutbox();
    return result;
  },
  async updateGalleryImage(tenantId: string, id: string, data: any) {
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.galleryImage.update({ where: { id_tenantId: { id, tenantId } }, data });
      await enqueueMenuProjection(tx, tenantId);
      return updated;
    });
    kickMenuProjectionOutbox();
    return result;
  },
  async deleteGalleryImage(tenantId: string, id: string) {
    const result = await prisma.$transaction(async (tx) => {
      const deleted = await tx.galleryImage.delete({ where: { id_tenantId: { id, tenantId } } });
      await enqueueMenuProjection(tx, tenantId);
      return deleted;
    });
    kickMenuProjectionOutbox();
    return result;
  },

  // Stories
  async getStories(tenantId: string) {
    return prisma.story.findMany({
      where: { tenantId },
      orderBy: { sortOrder: 'asc' },
    });
  },
  async createStory(tenantId: string, data: any) {
    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.story.create({ data: { ...data, tenantId } });
      await enqueueMenuProjection(tx, tenantId);
      return created;
    });
    kickMenuProjectionOutbox();
    return result;
  },
  async updateStory(tenantId: string, id: string, data: any) {
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.story.update({ where: { id_tenantId: { id, tenantId } }, data });
      await enqueueMenuProjection(tx, tenantId);
      return updated;
    });
    kickMenuProjectionOutbox();
    return result;
  },
  async deleteStory(tenantId: string, id: string) {
    const result = await prisma.$transaction(async (tx) => {
      const deleted = await tx.story.delete({ where: { id_tenantId: { id, tenantId } } });
      await enqueueMenuProjection(tx, tenantId);
      return deleted;
    });
    kickMenuProjectionOutbox();
    return result;
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
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
      if (!tenant) throw Object.assign(new Error('Tenant not found'), { statusCode: 404 });
      const updated = await tx.tenant.update({
        where: { id: tenantId },
        data: { settings: { ...(tenant.settings as object), ...newSettings } },
        select: { settings: true },
      });
      await enqueueMenuProjection(tx, tenantId);
      return updated;
    });
    kickMenuProjectionOutbox();
    return result;
  },

  // Reviews
  async getReviews(tenantId: string) {
    return prisma.review.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  },
  async createReview(tenantId: string, data: any) {
    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.review.create({ data: { ...data, tenantId } });
      await enqueueMenuProjection(tx, tenantId);
      return created;
    });
    kickMenuProjectionOutbox();
    return result;
  },
  async updateReview(tenantId: string, id: string, data: any) {
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.review.update({ where: { id_tenantId: { id, tenantId } }, data });
      await enqueueMenuProjection(tx, tenantId);
      return updated;
    });
    kickMenuProjectionOutbox();
    return result;
  },
  async deleteReview(tenantId: string, id: string) {
    const result = await prisma.$transaction(async (tx) => {
      const deleted = await tx.review.delete({ where: { id_tenantId: { id, tenantId } } });
      await enqueueMenuProjection(tx, tenantId);
      return deleted;
    });
    kickMenuProjectionOutbox();
    return result;
  },
};
