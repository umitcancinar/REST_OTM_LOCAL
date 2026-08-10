import { createHash, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { cloudEnv } from '../config/env.cloud';
import { apiError } from '../utils/apiResponse';

const SERVICE_HEADER = 'x-rest-otm-service-secret';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Superadmin BFF'e ozel makineden-makineye kimlik dogrulamasi.
 * Secret yalniz Render secret store'da bulunur ve TLS disinda tasinmaz.
 * Hash'leri karsilastirmak hem uzunluk sizintisini hem timing oracle'i onler.
 */
export function superAdminServiceAuth(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.get(SERVICE_HEADER) || '';
  const expected = cloudEnv.SUPERADMIN_BFF_SERVICE_SECRET;
  if (!supplied || !expected || !timingSafeEqual(digest(supplied), digest(expected))) {
    apiError(res, 401, 'Service authentication required.');
    return;
  }
  next();
}
