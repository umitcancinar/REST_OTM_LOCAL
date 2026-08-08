// ==========================================
// Inventory Controller
// ==========================================

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { getTenantId } from '../../middlewares/tenant.middleware';
import { inventoryService } from './inventory.service';
import { apiResponse, apiError } from '../../utils/apiResponse';

export const inventoryController = {
  // ─── Inventory Items ────────────────────
  async getAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const items = await inventoryService.findAll(getTenantId(req));
      apiResponse({ res, data: items });
    } catch (error) { next(error); }
  },

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const item = await inventoryService.findById(getTenantId(req), ((req.params.id as string)));
      if (!item) { apiError(res, 404, 'Inventory item not found'); return; }
      apiResponse({ res, data: item });
    } catch (error) { next(error); }
  },

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const item = await inventoryService.create(getTenantId(req), req.body);
      apiResponse({ res, statusCode: 201, data: item, message: 'Inventory item created' });
    } catch (error) { next(error); }
  },

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const item = await inventoryService.update(getTenantId(req), ((req.params.id as string)), req.body);
      apiResponse({ res, data: item, message: 'Inventory item updated' });
    } catch (error) { next(error); }
  },

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await inventoryService.delete(getTenantId(req), ((req.params.id as string)));
      apiResponse({ res, message: 'Inventory item deleted' });
    } catch (error) { next(error); }
  },

  async getStockAlerts(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const alerts = await inventoryService.getStockAlerts(getTenantId(req));
      apiResponse({ res, data: alerts });
    } catch (error) { next(error); }
  },

  // ─── Recipes ────────────────────────────
  async getRecipe(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const recipe = await inventoryService.getRecipe(getTenantId(req), (req.params.menuItemId as string));
      if (!recipe) { apiError(res, 404, 'Recipe not found'); return; }
      apiResponse({ res, data: recipe });
    } catch (error) { next(error); }
  },

  async createRecipe(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const recipe = await inventoryService.createRecipe(getTenantId(req), req.body);
      apiResponse({ res, statusCode: 201, data: recipe, message: 'Recipe created' });
    } catch (error) { next(error); }
  },

  // ─── Waste Logs ─────────────────────────
  async getWasteLogs(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const logs = await inventoryService.getWasteLogs(getTenantId(req));
      apiResponse({ res, data: logs });
    } catch (error) { next(error); }
  },

  async createWasteLog(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const log = await inventoryService.createWasteLog(getTenantId(req), {
        ...req.body,
        loggedById: req.user!.userId,
      });
      apiResponse({ res, statusCode: 201, data: log, message: 'Waste log created' });
    } catch (error) { next(error); }
  },
};
