// ==========================================
// Table Controller
// ==========================================

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { getTenantId } from '../../middlewares/tenant.middleware';
import { tableService } from './table.service';
import { apiResponse, apiError } from '../../utils/apiResponse';

export const tableController = {
  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tables = await tableService.findAll(getTenantId(req));
      apiResponse({ res, data: tables });
    } catch (error) { next(error); }
  },

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const table = await tableService.findById(getTenantId(req), ((req.params.id as string)));
      if (!table) { apiError(res, 404, 'Table not found'); return; }
      apiResponse({ res, data: table });
    } catch (error) { next(error); }
  },

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const table = await tableService.create(getTenantId(req), req.body);
      apiResponse({ res, statusCode: 201, data: table, message: 'Table created' });
    } catch (error) { next(error); }
  },

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const table = await tableService.update(getTenantId(req), ((req.params.id as string)), req.body);
      apiResponse({ res, data: table, message: 'Table updated' });
    } catch (error) { next(error); }
  },

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await tableService.delete(getTenantId(req), ((req.params.id as string)));
      apiResponse({ res, message: 'Table deleted' });
    } catch (error) { next(error); }
  },
};
