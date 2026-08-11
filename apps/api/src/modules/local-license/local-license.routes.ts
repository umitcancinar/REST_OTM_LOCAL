import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { LocalLicenseRuntime } from './local-license.runtime';
import {
  isLocalInstallationReady,
  provisionLocalInstallation,
} from './local-installation.service';

const activationSchema = z.object({
  licenseKey: z.string().trim().min(8).max(128),
}).strict();

function isLoopback(value: string): boolean {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

async function installationAwareStatus(runtime: LocalLicenseRuntime, revalidate = true) {
  const view = runtime.getStatusView(revalidate);
  const status = runtime.getStatus();
  if (status.state !== 'valid') return view;
  if (await isLocalInstallationReady(status.license.tenantId)) return view;
  return {
    ...view,
    operational: false,
    activationRequired: true,
    setupRequired: true,
    message: 'Lisans dogrulandi. Bu bilgisayarin ilk yonetici hesabi olusturulmali.',
  };
}

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

  router.get('/status', statusLimiter, async (_req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        data: await installationAwareStatus(runtime, true),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/activate', activationLimiter, async (req, res, next) => {
    try {
      // Ilk kurulum yetkisi LAN cihazina verilmez. Ana Windows bilgisayari
      // gateway'e 127.0.0.1 ile baglandiginda trusted proxy req.ip'yi loopback
      // olarak korur; uzaktaki istemcinin X-Forwarded-For degeri LAN IP'sidir.
      if (!isLoopback(req.ip ?? '')) {
        res.status(403).json({ success: false, message: 'Ilk aktivasyon ana REST_OTM bilgisayarinda yapilmalidir.' });
        return;
      }
      const { licenseKey } = activationSchema.parse(req.body);
      const { result, status } = await runtime.activate(licenseKey);
      let setupSession;
      if (result.ok) {
        const operational = runtime.assertOperationalLicense('activation');
        setupSession = await provisionLocalInstallation(operational.license);
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(result.ok ? 200 : 400).json({
        success: result.ok,
        message: result.message,
        data: result.ok
          ? { ...await installationAwareStatus(runtime, false), ...(setupSession && { setupSession }) }
          : status,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  const retry = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await runtime.heartbeat('heartbeat');
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: await installationAwareStatus(runtime, false), timestamp: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  };

  router.post('/heartbeat', retryLimiter, retry);
  router.post('/retry', retryLimiter, retry);

  return router;
}
