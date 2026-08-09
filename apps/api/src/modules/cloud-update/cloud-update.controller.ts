import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { apiResponse } from '../../utils/apiResponse';
import { cloudUpdateService } from './cloud-update.service';
import {
  cloudUpdateReleaseIdSchema,
  createCloudUpdateReleaseSchema,
  listCloudUpdateReleasesSchema,
  revokeCloudUpdateReleaseSchema,
  updateManifestRequestSchema,
} from './cloud-update.validation';

function context(req: AuthenticatedRequest) {
  if (!req.user) throw Object.assign(new Error('Kimlik dogrulama gerekli.'), { statusCode: 401 });
  return {
    operatorId: req.user.userId,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

export const cloudUpdateController = {
  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const input = createCloudUpdateReleaseSchema.parse(req.body);
      apiResponse({
        res,
        statusCode: 201,
        data: await cloudUpdateService.create(input, context(req)),
        message: 'Update release DRAFT olarak olusturuldu; artifact metadata artik degistirilemez.',
      });
    } catch (error) { next(error); }
  },

  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const input = listCloudUpdateReleasesSchema.parse(req.query);
      const result = await cloudUpdateService.list(input);
      apiResponse({
        res,
        data: result.items,
        meta: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: Math.ceil(result.total / result.limit),
        },
      });
    } catch (error) { next(error); }
  },

  async detail(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = cloudUpdateReleaseIdSchema.parse(req.params);
      apiResponse({ res, data: await cloudUpdateService.detail(id) });
    } catch (error) { next(error); }
  },

  async publish(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = cloudUpdateReleaseIdSchema.parse(req.params);
      apiResponse({
        res,
        data: await cloudUpdateService.publish(id, context(req)),
        message: 'Release canonical JSON olarak Ed25519 ile imzalandi ve yayinlandi.',
      });
    } catch (error) { next(error); }
  },

  async revoke(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = cloudUpdateReleaseIdSchema.parse(req.params);
      const { reason } = revokeCloudUpdateReleaseSchema.parse(req.body);
      apiResponse({
        res,
        data: await cloudUpdateService.revoke(id, reason, context(req)),
        message: 'Release geri cekildi; daha once stage edilmis paketler supervisor dogrulamasina tabidir.',
      });
    } catch (error) { next(error); }
  },

  async manifest(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (Object.keys(req.query).length > 0) {
        throw Object.assign(new Error('Update manifest endpoint query kabul etmez.'), { statusCode: 400 });
      }
      const request = updateManifestRequestSchema.parse({
        currentVersion: req.get('x-rest-otm-current-version'),
        channel: req.get('x-rest-otm-update-channel'),
      });
      const result = await cloudUpdateService.manifestFor(request.currentVersion, request.channel);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('Vary', 'X-Rest-Otm-Current-Version, X-Rest-Otm-Update-Channel');
      if (!result) {
        res.status(204).end();
        return;
      }
      res.setHeader('X-Rest-Otm-Update-Version', result.version);
      res.status(200).json(result.envelope);
    } catch (error) { next(error); }
  },
};
