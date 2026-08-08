// ==========================================
// Lisans Controller
// ==========================================
// Bu uc noktalar musterinin bilgisayarindan cagrilir; kimlik dogrulamasi
// yoktur. Yetkilendirmenin yerini lisans anahtari + donanim baglamasi tutar.

import { Request, Response, NextFunction } from 'express';
import { licenseService } from './license.service';
import {
  activateSchema,
  heartbeatSchema,
  type ActivateBody,
  type HeartbeatBody,
} from './license.validation';
import { apiResponse, apiError } from '../../utils/apiResponse';

/** Hatalari tek yerde ele al — her handler'da tekrar etmeyelim. */
function handle(res: Response, next: NextFunction, error: unknown) {
  const err = error as Error & { statusCode?: number };
  if (err.statusCode) {
    apiError(res, err.statusCode, err.message);
    return;
  }
  next(error);
}

export const licenseController = {
  /** POST /api/license/activate — ilk kurulumda bir kez. */
  async activate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = activateSchema.parse(req.body) as ActivateBody;
      const result = await licenseService.activate({ ...input, ip: req.ip });
      apiResponse({ res, data: result, message: 'Lisans etkinleştirildi' });
    } catch (error) {
      handle(res, next, error);
    }
  },

  /** POST /api/license/heartbeat — lokal taraf saatte bir cagirir. */
  async heartbeat(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = heartbeatSchema.parse(req.body) as HeartbeatBody;
      const result = await licenseService.heartbeat({ ...input, ip: req.ip });
      apiResponse({ res, data: result, message: 'Yoklama alındı' });
    } catch (error) {
      handle(res, next, error);
    }
  },
};
