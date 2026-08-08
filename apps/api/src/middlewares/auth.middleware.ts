// ==========================================
// JWT Authentication Middleware
// ==========================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { sharedEnv } from '../config/env.shared';
import { apiError } from '../utils/apiResponse';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    tenantId: string;
    role: string;
  };
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
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
    };

    req.user = {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      role: decoded.role,
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
