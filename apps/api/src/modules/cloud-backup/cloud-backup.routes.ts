import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { apiError, apiResponse } from '../../utils/apiResponse';
import { cloudBackupService } from './cloud-backup.service';
import {
  cloudBackupCompleteSchema,
  cloudBackupPresignSchema,
} from './cloud-backup.validation';

const router = Router();
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Çok fazla bulut yedekleme isteği.' },
});

function handle(res: Response, next: NextFunction, error: unknown) {
  const err = error as Error & { statusCode?: number };
  if (err.statusCode) return void apiError(res, err.statusCode, err.message);
  next(error);
}

router.post('/presign', limiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    apiResponse({ res, data: await cloudBackupService.presign(cloudBackupPresignSchema.parse(req.body)) });
  } catch (error) {
    handle(res, next, error);
  }
});

router.post('/complete', limiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    apiResponse({ res, data: await cloudBackupService.complete(cloudBackupCompleteSchema.parse(req.body)) });
  } catch (error) {
    handle(res, next, error);
  }
});

export default router;
