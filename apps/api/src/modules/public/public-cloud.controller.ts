import { NextFunction, Request, Response } from 'express';
import { prisma } from '../../config/database';
import { apiError, apiResponse } from '../../utils/apiResponse';

async function tenantIdForSlug(slug: string): Promise<string | undefined> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug, isActive: true },
    select: { id: true },
  });
  return tenant?.id;
}

function handler(
  action: (req: Request, res: Response) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req, res, next) => {
    try {
      await action(req, res);
    } catch (error) {
      next(error);
    }
  };
}

export const publicCloudController = {
  getTenantInfo: handler(async (req, res) => {
    const identifier = req.query.domain || req.query.slug;
    if (!identifier) return apiError(res, 400, 'domain or slug is required');
    const tenant = await prisma.tenant.findFirst({
      where: {
        OR: [{ slug: String(identifier) }, { customDomain: String(identifier) }],
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        customDomain: true,
        logo: true,
        settings: true,
        address: true,
        phone: true,
        email: true,
      },
    });
    if (!tenant) return apiError(res, 404, 'Restaurant not found');
    apiResponse({ res, data: tenant });
  }),

  getMenuBySlug: handler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: String(req.params.slug), isActive: true },
      select: { id: true, name: true },
    });
    if (!tenant) return apiError(res, 404, 'Restaurant not found');
    const categories = await prisma.menuCategory.findMany({
      where: { tenantId: tenant.id, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        items: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            image: true,
            basePrice: true,
            taxRate: true,
            portionOptions: true,
            extras: true,
            department: true,
            preparationTime: true,
            allergens: true,
            calories: true,
            extraInfo: true,
            badge: true,
            sortOrder: true,
            isActive: true,
          },
        },
      },
    });
    apiResponse({ res, data: { restaurantName: tenant.name, categories } });
  }),

  getMenu: handler(async (req, res) => {
    const tenantId = req.query.tenantId as string | undefined;
    if (!tenantId) return apiError(res, 400, 'tenantId is required');
    const categories = await prisma.menuCategory.findMany({
      where: { tenantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: { items: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    });
    apiResponse({ res, data: categories });
  }),

  getCmsSettings: handler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: String(req.params.slug), isActive: true },
      select: { settings: true },
    });
    if (!tenant) return apiError(res, 404, 'Restaurant not found');
    const settings = typeof tenant.settings === 'string'
      ? JSON.parse(tenant.settings)
      : tenant.settings;
    apiResponse({ res, data: settings });
  }),

  getGallery: handler(async (req, res) => {
    const tenantId = await tenantIdForSlug(String(req.params.slug));
    if (!tenantId) return apiError(res, 404, 'Restaurant not found');
    const images = await prisma.galleryImage.findMany({
      where: { tenantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    apiResponse({ res, data: images });
  }),

  getStories: handler(async (req, res) => {
    const tenantId = await tenantIdForSlug(String(req.params.slug));
    if (!tenantId) return apiError(res, 404, 'Restaurant not found');
    const stories = await prisma.story.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { sortOrder: 'asc' },
    });
    apiResponse({ res, data: stories });
  }),

  getReviews: handler(async (req, res) => {
    const tenantId = await tenantIdForSlug(String(req.params.slug));
    if (!tenantId) return apiError(res, 404, 'Restaurant not found');
    const reviews = await prisma.review.findMany({
      where: { tenantId, isApproved: true },
      orderBy: { createdAt: 'desc' },
    });
    apiResponse({ res, data: reviews });
  }),

  getReservations: handler(async (req, res) => {
    const tenantId = await tenantIdForSlug(String(req.params.slug));
    if (!tenantId) return apiError(res, 404, 'Restaurant not found');
    const reservations = await prisma.reservation.findMany({
      where: {
        tenantId,
        status: { in: ['CONFIRMED', 'PENDING'] },
        reservationTime: { gte: new Date() },
      },
      select: {
        id: true,
        tableId: true,
        reservationTime: true,
        guestCount: true,
        status: true,
      },
    });
    apiResponse({ res, data: reservations });
  }),

  getTableMap: handler(async (req, res) => {
    const tenantId = await tenantIdForSlug(String(req.params.slug));
    if (!tenantId) return apiError(res, 404, 'Restaurant not found');
    const tables = await prisma.restaurantTable.findMany({
      where: { tenantId },
      orderBy: { number: 'asc' },
    });
    apiResponse({ res, data: tables });
  }),

  getNavLinks: handler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({
      where: { slug: String(req.params.slug), isActive: true },
      select: { settings: true },
    });
    if (!tenant) return apiError(res, 404, 'Restaurant not found');
    const settings = typeof tenant.settings === 'string'
      ? JSON.parse(tenant.settings)
      : tenant.settings as Record<string, unknown> | null;
    apiResponse({
      res,
      data: settings && typeof settings === 'object' && 'navLinks' in settings
        ? settings.navLinks
        : [],
    });
  }),
};
