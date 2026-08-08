import prisma from '../../config/database';

export const customerService = {
  async findAll(tenantId: string, search?: string) {
    const where: any = { tenantId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }
    return prisma.customer.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        orders: {
          where: { isDeleted: false },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            orderNumber: true,
            createdAt: true,
            grandTotal: true,
            subChecks: {
              select: {
                items: {
                  where: { status: { not: 'CANCELLED' } },
                  select: { menuItemName: true, quantity: true },
                  take: 5,
                },
              },
            },
          },
        },
      },
    });
  },

  async findById(tenantId: string, id: string) {
    return prisma.customer.findFirst({
      where: { tenantId, id },
    });
  },

  async create(tenantId: string, data: { name: string; phone: string; address?: string; notes?: string }) {
    return prisma.customer.create({
      data: {
        tenantId,
        ...data,
      },
    });
  },

  async update(tenantId: string, id: string, data: { name?: string; phone?: string; address?: string; notes?: string }) {
    return prisma.customer.update({
      where: { id, tenantId },
      data,
    });
  },

  async deleteAll(tenantId: string) {
    return prisma.customer.deleteMany({ where: { tenantId } });
  },

  async delete(tenantId: string, id: string) {
    return prisma.customer.delete({
      where: { id, tenantId },
    });
  },
};
