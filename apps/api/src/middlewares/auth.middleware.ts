// ==========================================
// JWT Authentication Middleware
// ==========================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { sharedEnv } from '../config/env.shared';
import { apiError } from '../utils/apiResponse';
import prisma from '../config/database';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    tenantId: string;
    role: string;
    sessionType?: 'user' | 'local_setup';
  };
}

export async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      apiError(res, 401, 'Access denied. No token provided.');
      return;
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      apiError(res, 401, 'Access denied. Invalid token format.');
      return;
    }

    const decoded = jwt.verify(token, sharedEnv.JWT_ACCESS_SECRET) as {
      userId: string;
      tenantId: string;
      role: string;
      sessionType?: 'user' | 'local_setup';
    };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { tenantId: true, role: true, isActive: true },
    });
    if (
      !user?.isActive
      || user.role !== decoded.role
      || (user.tenantId ?? null) !== (decoded.tenantId ?? null)
    ) {
      apiError(res, 401, 'Oturum kullanicisi artik aktif degil.');
      return;
    }

    if (decoded.sessionType === 'local_setup') {
      const path = req.originalUrl.split('?', 1)[0];
      const allowed = path === '/api/staff' && (req.method === 'GET' || req.method === 'POST');
      if (!allowed) {
        apiError(res, 403, 'Ilk kurulum oturumu yalniz Personel ekranini kullanabilir.');
        return;
      }
    }

    req.user = {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      role: decoded.role,
      sessionType: decoded.sessionType ?? 'user',
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      apiError(res, 401, 'Token expired. Please refresh your token.');
      return;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      apiError(res, 401, 'Invalid token.');
      return;
    }
    apiError(res, 500, 'Internal authentication error.');
  }
}
