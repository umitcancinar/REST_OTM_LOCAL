import { NextFunction, Request, Response } from 'express';
import prisma from '../../config/database';
import { apiError, apiResponse } from '../../utils/apiResponse';
import {
  type MenuPublicationPayload,
  menuPublicationPayloadSchema,
} from '../publication-contract/menu-publication.contract';

type PublicationView = {
  version: number;
  checksum: string;
  payload: MenuPublicationPayload;
  publishedAt: Date;
};

function handler(
  action: (req: Request, res: Response) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req, res, next) => {
    try { await action(req, res); }
    catch (error) { next(error); }
  };
}

async function byIdentifier(identifier: string): Promise<PublicationView | null> {
  const publication = await prisma.menuPublication.findFirst({
    where: { disabledAt: null, OR: [{ slug: identifier }, { customDomain: identifier }] },
    select: { version: true, checksum: true, payload: true, publishedAt: true },
  });
  if (!publication) return null;
  return { ...publication, payload: menuPublicationPayloadSchema.parse(publication.payload) };
}

function setPublicationCache(req: Request, res: Response, publication: PublicationView): boolean {
  const etag = `"${publication.checksum}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  if (req.header('if-none-match') === etag) {
    res.status(304).end();
    return true;
  }
  return false;
}

async function requiredBySlug(req: Request, res: Response): Promise<PublicationView | null> {
  const publication = await byIdentifier(String(req.params.slug));
  if (!publication) {
    apiError(res, 404, 'Restaurant not found');
    return null;
  }
  if (setPublicationCache(req, res, publication)) return null;
  return publication;
}

export const publicCloudController = {
  getTenantInfo: handler(async (req, res) => {
    const identifier = req.query.domain || req.query.slug;
    if (!identifier) return apiError(res, 400, 'domain or slug is required');
    const publication = await byIdentifier(String(identifier));
    if (!publication) return apiError(res, 404, 'Restaurant not found');
    if (setPublicationCache(req, res, publication)) return;
    return apiResponse({ res, data: publication.payload.tenant });
  }),

  getMenuBySlug: handler(async (req, res) => {
    const publication = await requiredBySlug(req, res);
    if (!publication || res.headersSent) return;
    return apiResponse({ res, data: publication.payload.menu });
  }),

  getMenu: handler(async (req, res) => {
    const publicId = req.query.tenantId;
    if (!publicId) return apiError(res, 400, 'tenantId is required');
    const publication = await prisma.menuPublication.findFirst({
      where: {
        disabledAt: null,
        OR: [{ publicId: String(publicId) }, { tenantId: String(publicId) }],
      },
      select: { version: true, checksum: true, payload: true, publishedAt: true },
    });
    if (!publication) return apiError(res, 404, 'Restaurant not found');
    const view = { ...publication, payload: menuPublicationPayloadSchema.parse(publication.payload) };
    if (setPublicationCache(req, res, view)) return;
    return apiResponse({ res, data: view.payload.menu.categories });
  }),

  getCmsSettings: handler(async (req, res) => {
    const publication = await requiredBySlug(req, res);
    if (!publication || res.headersSent) return;
    return apiResponse({ res, data: publication.payload.cms.settings });
  }),

  getGallery: handler(async (req, res) => {
    const publication = await requiredBySlug(req, res);
    if (!publication || res.headersSent) return;
    return apiResponse({ res, data: publication.payload.cms.gallery });
  }),

  getStories: handler(async (req, res) => {
    const publication = await requiredBySlug(req, res);
    if (!publication || res.headersSent) return;
    const now = Date.now();
    return apiResponse({
      res,
      data: publication.payload.cms.stories.filter((story) => (
        !story.expiresAt || Date.parse(story.expiresAt) > now
      )),
    });
  }),

  getReviews: handler(async (req, res) => {
    const publication = await requiredBySlug(req, res);
    if (!publication || res.headersSent) return;
    return apiResponse({ res, data: publication.payload.cms.reviews });
  }),

  getNavLinks: handler(async (req, res) => {
    const publication = await requiredBySlug(req, res);
    if (!publication || res.headersSent) return;
    return apiResponse({ res, data: publication.payload.cms.navLinks });
  }),

  // Compatibility-only cloud routes. Operational reservations/table layout
  // are intentionally never projected; existing clients keep a stable array response.
  getReservations: handler(async (req, res) => {
    const publication = await requiredBySlug(req, res);
    if (!publication || res.headersSent) return;
    return apiResponse({ res, data: [] });
  }),
  getTableMap: handler(async (req, res) => {
    const publication = await requiredBySlug(req, res);
    if (!publication || res.headersSent) return;
    return apiResponse({ res, data: [] });
  }),

  getPublication: handler(async (req, res) => {
    const publication = await requiredBySlug(req, res);
    if (!publication || res.headersSent) return;
    return apiResponse({
      res,
      data: {
        version: publication.version,
        checksum: publication.checksum,
        publishedAt: publication.publishedAt,
        ...publication.payload,
      },
    });
  }),
};
