import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { apiError, apiResponse } from '../../utils/apiResponse';
import { superAdminMfaService } from './superadmin-mfa.service';

const startSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
}).strict();

const verifySchema = z.object({
  challengeId: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  code: z.string().regex(/^\d{6}$/),
}).strict();

function context(req: Request) {
  return { userAgent: req.get('user-agent') || undefined, ip: req.ip };
}

function handle(error: unknown, res: Response, next: NextFunction): void {
  const err = error as Error & { statusCode?: number };
  if (err.statusCode) {
    apiError(res, err.statusCode, err.message);
    return;
  }
  if (error instanceof z.ZodError) {
    apiError(res, 400, 'İstek biçimi geçersiz.');
    return;
  }
  next(error);
}

export const superAdminMfaController = {
  async start(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = startSchema.parse(req.body);
      const result = await superAdminMfaService.start(input, context(req));
      // code yalniz service-auth ile dogrulanmis BFF'e doner; browser'a BFF
      // cevabinda aktarilmaz ve loglanmaz.
      apiResponse({ res, statusCode: 201, data: result, message: 'MFA challenge created.' });
    } catch (error) {
      handle(error, res, next);
    }
  },

  async verify(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { challengeId, code } = verifySchema.parse(req.body);
      const result = await superAdminMfaService.verify(challengeId, code, context(req));
      apiResponse({ res, data: result, message: 'MFA verified.' });
    } catch (error) {
      handle(error, res, next);
    }
  },
};
