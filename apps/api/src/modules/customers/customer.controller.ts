import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { getTenantId } from '../../middlewares/tenant.middleware';
import { customerService } from './customer.service';
import { apiResponse, apiError } from '../../utils/apiResponse';

export const customerController = {
  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const search = req.query.search as string | undefined;
      const customers = await customerService.findAll(tenantId, search);
      apiResponse({ res, data: customers });
    } catch (error) { next(error); }
  },

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const customer = await customerService.findById(getTenantId(req), (req.params.id as string));
      if (!customer) { apiError(res, 404, 'Customer not found'); return; }
      apiResponse({ res, data: customer });
    } catch (error) { next(error); }
  },

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const customer = await customerService.create(tenantId, req.body);
      apiResponse({ res, statusCode: 201, data: customer, message: 'Customer created' });
    } catch (error) { next(error); }
  },

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const customer = await customerService.update(getTenantId(req), (req.params.id as string), req.body);
      apiResponse({ res, data: customer, message: 'Customer updated' });
    } catch (error) { next(error); }
  },

  async bulkDelete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await customerService.deleteAll(getTenantId(req));
      apiResponse({ res, message: 'All customers deleted' });
    } catch (error) { next(error); }
  },

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await customerService.delete(getTenantId(req), (req.params.id as string));
      apiResponse({ res, message: 'Customer deleted' });
    } catch (error) { next(error); }
  },
};
