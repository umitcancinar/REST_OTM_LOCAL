// ==========================================
// Menu Service (Categories + Items)
// ==========================================

import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import { resolvePreparationDepartment } from '../../utils/department-routing';

export const menuService = {
  // ─── Categories ─────────────────────────
  async getCategories(tenantId: string, onlyActive = false) {
    return prisma.menuCategory.findMany({
      where: { 
        tenantId,
        ...(onlyActive ? { isActive: true } : {})
      },
      include: { 
        items: { 
          where: onlyActive ? { isActive: true } : {},
          orderBy: { sortOrder: 'asc' } 
        } 
      },
      orderBy: { sortOrder: 'asc' },
    });
  },

  async createCategory(tenantId: string, data: { name: string; description?: string; sortOrder?: number }) {
    const category = await prisma.menuCategory.create({
      data: { tenantId, ...data },
    });
    logger.info(`Category created: ${category.name} (tenant: ${tenantId})`);
    return category;
  },

  async updateCategory(tenantId: string, id: string, data: Partial<{ name: string; description: string; sortOrder: number; isActive: boolean }>) {
    const category = await prisma.menuCategory.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!category) throw Object.assign(new Error('Category not found'), { statusCode: 404 });
    return prisma.menuCategory.update({
      where: { id: category.id },
      data,
    });
  },

  async deleteCategory(tenantId: string, id: string) {
    const category = await prisma.menuCategory.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!category) throw Object.assign(new Error('Category not found'), { statusCode: 404 });
    return prisma.menuCategory.delete({ where: { id: category.id } });
  },

  async reorderCategories(tenantId: string, orderedIds: string[]) {
    const transaction = orderedIds.map((id, index) =>
      prisma.menuCategory.updateMany({
        where: { id, tenantId },
        data: { sortOrder: index },
      })
    );
    await prisma.$transaction(transaction);
    return { success: true };
  },

  // ─── Menu Items ─────────────────────────
  async getItems(tenantId: string, categoryId?: string, onlyActive = false) {
    const items = await prisma.menuItem.findMany({
      where: { 
        tenantId, 
        ...(categoryId ? { categoryId } : {}),
        ...(onlyActive ? { isActive: true } : {})
      },
      include: { category: { select: { id: true, name: true } } },
      orderBy: { sortOrder: 'asc' },
    });

    return items.map((item) => ({
      ...item,
      department: resolvePreparationDepartment(item.department, item.category.name),
    }));
  },

  async getItemById(tenantId: string, id: string) {
    return prisma.menuItem.findFirst({
      where: { id, tenantId },
      include: {
        category: { select: { id: true, name: true } },
        recipes: { include: { ingredients: true } },
      },
    });
  },

  async createItem(tenantId: string, data: {
    categoryId: string;
    name: string;
    description?: string;
    image?: string;
    basePrice: number;
    portionOptions?: unknown;
    extras?: unknown;
    department?: string;
    preparationTime?: number;
    calories?: number;
    allergens?: unknown;
    extraInfo?: string;
    badge?: string;
  }) {
    let department = data.department;
    if (!department) {
      const category = await prisma.menuCategory.findFirst({
        where: { id: data.categoryId, tenantId },
        select: { name: true },
      });
      department = resolvePreparationDepartment('KITCHEN', category?.name);
    }

    const item = await prisma.menuItem.create({
      data: {
        tenantId,
        categoryId: data.categoryId,
        name: data.name,
        description: data.description,
        basePrice: data.basePrice,
        portionOptions: data.portionOptions as any ?? [],
        extras: data.extras as any ?? [],
        department: department as any,
        preparationTime: data.preparationTime,
        calories: data.calories,
        allergens: data.allergens as any ?? [],
        extraInfo: data.extraInfo,
        badge: data.badge,
        image: data.image,
      },
    });
    logger.info(`Menu item created: ${item.name} (${item.basePrice} TL)`);
    return item;
  },

  async updateItem(tenantId: string, id: string, data: Record<string, unknown>) {
    const item = await prisma.menuItem.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!item) throw Object.assign(new Error('Menu item not found'), { statusCode: 404 });
    return prisma.menuItem.update({ where: { id: item.id }, data: data as any });
  },

  async deleteItem(tenantId: string, id: string) {
    const item = await prisma.menuItem.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!item) throw Object.assign(new Error('Menu item not found'), { statusCode: 404 });
    return prisma.menuItem.delete({ where: { id: item.id } });
  },
};
