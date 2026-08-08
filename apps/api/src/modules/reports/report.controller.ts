// ==========================================
// Report Controller
// ==========================================

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { getTenantId } from '../../middlewares/tenant.middleware';
import { reportService } from './report.service';
import { apiResponse } from '../../utils/apiResponse';

export const reportController = {
  async getDailySummary(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const startDate = (req.query.startDate as string) || (req.query.date as string) || new Date().toISOString().split('T')[0];
      const endDate = (req.query.endDate as string) || (req.query.date as string) || new Date().toISOString().split('T')[0];
      
      const summary = await reportService.getSummaryInRange(getTenantId(req), startDate, endDate);
      apiResponse({ res, data: summary });
    } catch (error) { next(error); }
  },

  async getRevenueByRange(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate } = req.query as { startDate: string; endDate: string };
      const revenue = await reportService.getRevenueByRange(getTenantId(req), startDate, endDate);
      apiResponse({ res, data: revenue });
    } catch (error) { next(error); }
  },

  async getDepartmentStats(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
      const stats = await reportService.getDepartmentStats(getTenantId(req), date);
      apiResponse({ res, data: stats });
    } catch (error) { next(error); }
  },
};
