// ==========================================
// Table Service
// ==========================================

import prisma from '../../config/database';

export const tableService = {
  async findAll(tenantId: string) {
    const tables = await prisma.restaurantTable.findMany({
      where: { tenantId },
      include: {
        orders: {
          where: { 
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
            isDeleted: false
          },
          select: {
            id: true,
            status: true,
            grandTotal: true
          }
        }
      }
    });

    return tables.sort((a, b) => {
      const zoneA = a.zone || '';
      const zoneB = b.zone || '';
      if (zoneA !== zoneB) {
        return zoneA.localeCompare(zoneB);
      }
      return a.number.localeCompare(b.number, undefined, { numeric: true, sensitivity: 'base' });
    });
  },

  async findById(tenantId: string, id: string) {
    return prisma.restaurantTable.findFirst({ where: { id, tenantId } });
  },

  async create(tenantId: string, data: { number: string; zone?: string; capacity?: number; positionX?: number; positionY?: number }) {
    return prisma.restaurantTable.create({
      data: { tenantId, ...data },
    });
  },

  async update(tenantId: string, id: string, data: Partial<{ number: string; zone: string; capacity: number; status: string; positionX: number; positionY: number }>) {
    return prisma.restaurantTable.update({
      where: { id, tenantId },
      data: data as any,
    });
  },

  async updateStatus(tenantId: string, id: string, status: string) {
    return prisma.restaurantTable.update({
      where: { id, tenantId },
      data: { status: status as any },
    });
  },

  async delete(tenantId: string, id: string) {
    return prisma.restaurantTable.delete({ where: { id, tenantId } });
  },
};
