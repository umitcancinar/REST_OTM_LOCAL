// ==========================================
// Role-Based Access Control (RBAC) Middleware
// ==========================================

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import { apiError } from '../utils/apiResponse';

/**
 * Role hierarchy (higher index = more permissions):
 * WAITER < CASHIER < CHEF < OWNER < SUPER_ADMIN
 */
const ROLE_HIERARCHY: Record<string, number> = {
  WAITER: 1,
  CASHIER: 2,
  CHEF: 3,
  ADMIN: 4,
  OWNER: 5,
  SUPER_ADMIN: 6,
};

/**
 * Restrict access to users with one of the allowed roles.
 * Usage: router.get('/admin', authMiddleware, rbac('OWNER', 'SUPER_ADMIN'), handler)
 */
export function rbac(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      apiError(res, 401, 'Authentication required.');
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      apiError(res, 403, `Access denied. Required roles: ${allowedRoles.join(', ')}`);
      return;
    }

    next();
  };
}

/**
 * Restrict access to users with at least the minimum role level.
 * Usage: router.get('/reports', authMiddleware, minRole('CHEF'), handler)
 */
export function minRole(minimumRole: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      apiError(res, 401, 'Authentication required.');
      return;
    }

    const userLevel = ROLE_HIERARCHY[req.user.role] || 0;
    const requiredLevel = ROLE_HIERARCHY[minimumRole] || 0;

    if (userLevel < requiredLevel) {
      apiError(res, 403, `Access denied. Minimum role required: ${minimumRole}`);
      return;
    }

    next();
  };
}
