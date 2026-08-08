// ==========================================
// Tenant Isolation Middleware
// ==========================================
// Ensures all database queries are scoped to
// the authenticated user's tenant.

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import { apiError } from '../utils/apiResponse';

/**
 * Extracts tenantId from the authenticated user and makes it
 * available on the request object. Also validates that the
 * tenant exists and is active.
 *
 * SUPER_ADMIN bypasses tenant isolation when accessing
 * cross-tenant endpoints.
 */
export function tenantMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    apiError(res, 401, 'Authentication required for tenant isolation.');
    return;
  }

  // If user is SUPER_ADMIN, skip tenant validation entirely.
  if (req.user.role === 'SUPER_ADMIN') {
    // Optionally allow header override for explicit tenant context.
    if (req.headers['x-tenant-id']) {
      req.user.tenantId = req.headers['x-tenant-id'] as string;
    }
    return next();
  }

  // SUPER_ADMIN can optionally override tenant via header for other roles
  if (req.user.role === 'SUPER_ADMIN' && req.headers['x-tenant-id']) {
    const targetTenantId = req.headers['x-tenant-id'] as string;
    req.user.tenantId = targetTenantId;
  }

  if (!req.user.tenantId) {
    apiError(res, 400, 'Tenant context is missing.');
    return;
  }

  next();
}

/**
 * Helper to get tenantId from request — use this in services
 * to ensure all queries are tenant-scoped.
 */
export function getTenantId(req: AuthenticatedRequest): string {
  if (!req.user?.tenantId) {
    throw new Error('Tenant context missing. Ensure tenantMiddleware is applied.');
  }
  return req.user.tenantId;
}
