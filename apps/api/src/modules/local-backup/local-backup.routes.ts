import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import {
  backupStoredSha256,
  LocalBackupError,
  LocalBackupRuntime,
} from './local-backup.runtime';

/**
 * Lisans kilitliyken acik kalmasi guvenli olan yedek endpoint'leri.
 * Restore/import ve genel bir prefix bilerek yoktur.
 */
export const LOCAL_BACKUP_RECOVERY_RULES = [
  { path: '/api/backup/status', methods: ['GET', 'HEAD'] as const },
  { path: '/api/backup', methods: ['GET', 'HEAD'] as const },
  { path: '/api/backup/export', methods: ['POST'] as const },
  { path: '/api/backup/download', methods: ['GET', 'HEAD'] as const, match: 'prefix' as const },
] as const;

function sendLocalBackupError(error: LocalBackupError, res: Response): void {
  res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
    timestamp: new Date().toISOString(),
  });
}

/**
 * authorizationGuards zorunludur. Boylece modulu gate'in onune tasimak,
 * endpoint'leri kazara kimlik dogrulamasiz birakmaz.
 */
export function createLocalBackupRouter(
  runtime: LocalBackupRuntime,
  authorizationGuards: readonly RequestHandler[],
): Router {
  if (authorizationGuards.length === 0) {
    throw new LocalBackupError(
      'BACKUP_AUTH_REQUIRED',
      'Yedek rotalari en az bir kimlik/yetki guardi gerektirir.',
    );
  }

  const router = Router();
  for (const guard of authorizationGuards) router.use(guard);

  const readLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const exportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 6,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Cok fazla yedekleme istegi yapildi.' },
  });

  router.get('/status', readLimiter, async (_req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: await runtime.getStatus(), timestamp: new Date().toISOString() });
    } catch (error) {
      if (error instanceof LocalBackupError) sendLocalBackupError(error, res);
      else next(error);
    }
  });

  router.get('/', readLimiter, async (_req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: await runtime.listBackups(), timestamp: new Date().toISOString() });
    } catch (error) {
      if (error instanceof LocalBackupError) sendLocalBackupError(error, res);
      else next(error);
    }
  });

  router.post('/export', exportLimiter, async (_req, res, next) => {
    try {
      const backup = await runtime.createBackup('manual');
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json({
        success: true,
        message: 'Yedek guvenli sekilde olusturuldu.',
        data: backup,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof LocalBackupError) sendLocalBackupError(error, res);
      else next(error);
    }
  });

  router.get('/download/:backupId', readLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawBackupId = req.params.backupId;
      const backupId = Array.isArray(rawBackupId) ? rawBackupId[0] ?? '' : rawBackupId ?? '';
      const download = await runtime.getVerifiedDownload(backupId);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Rest-Otm-Backup-Sha256', backupStoredSha256(download.manifest));
      res.download(
        download.absolutePath,
        download.manifest.fileName,
        { cacheControl: false, dotfiles: 'deny', immutable: false },
        (error) => {
          if (!error || res.headersSent) return;
          next(error);
        },
      );
    } catch (error) {
      if (error instanceof LocalBackupError) sendLocalBackupError(error, res);
      else next(error);
    }
  });

  return router;
}
