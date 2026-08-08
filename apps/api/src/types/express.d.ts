// ==========================================
// Express Type Extensions
// ==========================================
// Fix for Express 5 req.params returning string | string[]

import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      params: Record<string, string>;
      query: Record<string, string>;
    }
  }
}

export {};
