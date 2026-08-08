// ==========================================
// Feature Flag (Licensing) Middleware
// ==========================================

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import { apiError } from '../utils/apiResponse';
import prisma from '../config/database';

/**
 * Checks if a specific feature is enabled for the current tenant.
 * SUPER_ADMIN bypasses this check.
 */
export const checkFeature = (featureKey: string) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return apiError(res, 401, 'Authentication required.');
    }

    // Super Admin bypasses feature checks
    if (req.user.role === 'SUPER_ADMIN') {
      return next();
    }

    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: req.user.tenantId },
        select: { settings: true }
      });

      if (!tenant) {
        return apiError(res, 404, 'Restaurant not found.');
      }

      const settings: any = typeof tenant.settings === 'string' 
        ? JSON.parse(tenant.settings) 
        : tenant.settings;
        
      const features = settings?.features || {
        website: true,
        reservations: true,
        takeaway: true,
        pos: true
      };

      if (!features[featureKey]) {
        return apiError(res, 403, `Bu modül (${featureKey}) lisansınızda tanımlı değil. Lütfen sistem yöneticisi ile iletişime geçin.`);
      }

      next();
    } catch (err) {
      console.error('Feature check error:', err);
      next(); // Fail-safe: allow if check fails? Or block? Let's allow for now to prevent breaking everything on small JSON errors.
    }
  };
};
