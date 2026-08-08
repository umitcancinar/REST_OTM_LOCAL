// ==========================================
// Menu Controller
// ==========================================

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../middlewares/auth.middleware';
import { getTenantId } from '../../middlewares/tenant.middleware';
import { menuService } from './menu.service';
import { apiResponse, apiError } from '../../utils/apiResponse';

export const menuController = {
  // ─── Categories ─────────────────────────
  async getCategories(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const includeInactive = req.query.includeInactive === 'true';
      
      const categories = await menuService.getCategories(tenantId, !includeInactive);
      apiResponse({ res, data: categories });
    } catch (error) { next(error); }
  },

  async createCategory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const category = await menuService.createCategory(tenantId, req.body);
      apiResponse({ res, statusCode: 201, data: category, message: 'Category created' });
    } catch (error) { next(error); }
  },

  async updateCategory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const category = await menuService.updateCategory(tenantId, ((req.params.id as string)), req.body);
      apiResponse({ res, data: category, message: 'Category updated' });
    } catch (error) { next(error); }
  },

  async deleteCategory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      await menuService.deleteCategory(tenantId, ((req.params.id as string)));
      apiResponse({ res, message: 'Category deleted' });
    } catch (error) { next(error); }
  },

  async reorderCategories(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const { orderedIds } = req.body;
      if (!Array.isArray(orderedIds)) {
        return apiError(res, 400, 'orderedIds must be an array of category IDs');
      }
      await menuService.reorderCategories(tenantId, orderedIds);
      apiResponse({ res, message: 'Categories reordered successfully' });
    } catch (error) { next(error); }
  },

  // ─── Menu Items ─────────────────────────
  async getItems(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const categoryId = req.query.categoryId as string | undefined;
      const includeInactive = req.query.includeInactive === 'true';

      const items = await menuService.getItems(tenantId, categoryId, !includeInactive);
      apiResponse({ res, data: items });
    } catch (error) { next(error); }
  },

  async getItemById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const item = await menuService.getItemById(tenantId, ((req.params.id as string)));
      if (!item) { apiError(res, 404, 'Menu item not found'); return; }
      apiResponse({ res, data: item });
    } catch (error) { next(error); }
  },

  async createItem(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const item = await menuService.createItem(tenantId, req.body);
      apiResponse({ res, statusCode: 201, data: item, message: 'Menu item created' });
    } catch (error) { next(error); }
  },

  async updateItem(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      const item = await menuService.updateItem(tenantId, ((req.params.id as string)), req.body);
      apiResponse({ res, data: item, message: 'Menu item updated' });
    } catch (error) { next(error); }
  },

  async deleteItem(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const tenantId = getTenantId(req);
      await menuService.deleteItem(tenantId, ((req.params.id as string)));
      apiResponse({ res, message: 'Menu item deleted' });
    } catch (error) { next(error); }
  },
};
