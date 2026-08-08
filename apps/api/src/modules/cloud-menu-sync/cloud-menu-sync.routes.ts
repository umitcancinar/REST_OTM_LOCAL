import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { apiError, apiResponse } from '../../utils/apiResponse';
import {
  MENU_PUBLICATION_MAX_BYTES,
  menuPublicationPushSchema,
} from '../publication-contract/menu-publication.contract';
import { authenticateCloudMenuSync } from './cloud-menu-sync.auth';
import { applyMenuPublication } from './cloud-menu-sync.service';

const router = Router();
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/publications', limiter, async (req, res, next) => {
  try {
    const declaredBytes = Number(req.header('content-length'));
    if (Number.isFinite(declaredBytes) && declaredBytes > MENU_PUBLICATION_MAX_BYTES) {
      return apiError(res, 413, 'Publication exceeds 512 KiB');
    }
    const measuredBytes = Buffer.byteLength(JSON.stringify(req.body));
    if (measuredBytes > MENU_PUBLICATION_MAX_BYTES) {
      return apiError(res, 413, 'Publication exceeds 512 KiB');
    }
    const publication = menuPublicationPushSchema.parse(req.body);
    const expectedIdempotencyKey = `menu-v${publication.version}-${publication.checksum}`;
    if (req.header('idempotency-key') !== expectedIdempotencyKey) {
      return apiError(res, 400, 'Invalid idempotency key');
    }
    const identity = await authenticateCloudMenuSync(
      req.header('x-resto-license-key'),
      req.header('x-resto-hardware-id'),
    );
    const result = await applyMenuPublication(identity, publication);
    return apiResponse({ res, data: result, message: 'Publication accepted' });
  } catch (error) {
    if (error instanceof ZodError) return apiError(res, 400, 'Invalid publication payload');
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode) return apiError(res, statusCode, (error as Error).message);
    return next(error);
  }
});

export default router;
