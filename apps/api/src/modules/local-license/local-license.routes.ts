import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { LocalLicenseRuntime } from './local-license.runtime';

const activationSchema = z.object({
  licenseKey: z.string().trim().min(8).max(128),
}).strict();

export function createLocalLicenseRouter(runtime: LocalLicenseRuntime): Router {
  const router = Router();

  const statusLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const activationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Cok fazla etkinlestirme denemesi yapildi.' },
  });
  const retryLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Cok fazla lisans yoklamasi yapildi.' },
  });

  router.get('/status', statusLimiter, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: runtime.getStatusView(true),
      timestamp: new Date().toISOString(),
    });
  });

  router.post('/activate', activationLimiter, async (req, res, next) => {
    try {
      const { licenseKey } = activationSchema.parse(req.body);
      const { result, status } = await runtime.activate(licenseKey);
      res.setHeader('Cache-Control', 'no-store');
      res.status(result.ok ? 200 : 400).json({
        success: result.ok,
        message: result.message,
        data: status,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  const retry = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const status = await runtime.heartbeat('heartbeat');
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: status, timestamp: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  };

  router.post('/heartbeat', retryLimiter, retry);
  router.post('/retry', retryLimiter, retry);

  return router;
}
