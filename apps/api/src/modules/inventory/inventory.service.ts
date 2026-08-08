// ==========================================
// Inventory & Recipe Service
// ==========================================

import prisma from '../../config/database';
import { logger } from '../../utils/logger';

export const inventoryService = {
  // ─── Inventory Items ────────────────────
  async findAll(tenantId: string) {
    return prisma.inventoryItem.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  },

  async findById(tenantId: string, id: string) {
    return prisma.inventoryItem.findFirst({ where: { id, tenantId } });
  },

  async create(tenantId: string, data: {
    name: string;
    unit: string;
    currentStock: number;
    minStockAlert: number;
    costPerUnit: number;
    supplier?: string;
  }) {
    return prisma.inventoryItem.create({
      data: { tenantId, ...data } as any,
    });
  },

  async update(tenantId: string, id: string, data: Record<string, unknown>) {
    return prisma.inventoryItem.update({ where: { id, tenantId }, data: data as any });
  },

  async delete(tenantId: string, id: string) {
    return prisma.inventoryItem.delete({ where: { id, tenantId } });
  },

  /** Check and return items below minimum stock threshold */
  async getStockAlerts(tenantId: string) {
    const items = await prisma.inventoryItem.findMany({
      where: { tenantId, isActive: true },
    });

    return items
      .filter((item) => item.currentStock <= item.minStockAlert)
      .map((item) => ({
        inventoryItemId: item.id,
        itemName: item.name,
        currentStock: item.currentStock,
        minStockAlert: item.minStockAlert,
        unit: item.unit,
        severity: item.currentStock <= 0 ? 'critical' as const : 'warning' as const,
      }));
  },

  // ─── Recipes ────────────────────────────
  async getRecipe(tenantId: string, menuItemId: string) {
    return prisma.recipe.findFirst({
      where: { tenantId, menuItemId },
      include: {
        ingredients: {
          include: { inventoryItem: { select: { name: true, unit: true, currentStock: true } } },
        },
      },
    });
  },

  async createRecipe(tenantId: string, data: {
    menuItemId: string;
    ingredients: Array<{ inventoryItemId: string; quantity: number; unit: string }>;
  }) {
    return prisma.recipe.create({
      data: {
        tenantId,
        menuItemId: data.menuItemId,
        ingredients: {
          create: data.ingredients.map((ing) => ({
            inventoryItemId: ing.inventoryItemId,
            quantity: ing.quantity,
            unit: ing.unit as any,
          })),
        },
      },
      include: { ingredients: true },
    });
  },

  /**
   * Deduct stock based on sold items.
   * Called when an order is CONFIRMED.
   */
  async deductStockForOrder(tenantId: string, orderItems: Array<{ menuItemId: string; quantity: number; portionMultiplier: number }>) {
    await prisma.$transaction(async (tx) => {
      for (const item of orderItems) {
        const recipe = await tx.recipe.findFirst({
          where: { tenantId, menuItemId: item.menuItemId },
          include: { ingredients: true },
        });

        if (!recipe) continue; // No recipe defined, skip

        for (const ingredient of recipe.ingredients) {
          const deductAmount = ingredient.quantity * item.quantity * item.portionMultiplier;

          await tx.inventoryItem.update({
            where: { id: ingredient.inventoryItemId, tenantId },
            data: {
              currentStock: { decrement: deductAmount },
            },
          });

          logger.debug(`Stock deducted: ${ingredient.inventoryItemId} -= ${deductAmount}`);
        }
      }
    });
  },

  // ─── Waste Logs ─────────────────────────
  async getWasteLogs(tenantId: string) {
    return prisma.wasteLog.findMany({
      where: { tenantId },
      include: {
        inventoryItem: { select: { name: true, unit: true } },
        loggedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async createWasteLog(tenantId: string, data: {
    inventoryItemId: string;
    quantity: number;
    reason: string;
    loggedById: string;
  }) {
    return prisma.$transaction(async (tx) => {
      // Deduct from stock
      await tx.inventoryItem.update({
        where: { id: data.inventoryItemId, tenantId },
        data: { currentStock: { decrement: data.quantity } },
      });

      return tx.wasteLog.create({
        data: { tenantId, ...data },
      });
    });
  },
};
