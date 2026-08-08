import { NextFunction, Request, Response } from 'express';
import { prisma } from '../../config/database';
import { getIO } from '../../websocket/socket.server';
import { apiError, apiResponse } from '../../utils/apiResponse';

export async function callLocalWaiter(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const slug = String(req.params.slug || '');
    const { tableId } = req.body as { tableId?: string };
    if (!tableId) {
      apiError(res, 400, 'Masa numarası gereklidir.');
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { slug, isActive: true },
      select: { id: true },
    });
    if (!tenant) {
      apiError(res, 404, 'Restoran bulunamadı.');
      return;
    }

    const table = await prisma.restaurantTable.findFirst({
      where: { id: tableId, tenantId: tenant.id },
      select: { id: true },
    });
    if (!table) {
      apiError(res, 404, 'Masa bulunamadı.');
      return;
    }

    getIO().to(`tenant:${tenant.id}`).emit('waiter:called', {
      tableId,
      time: new Date().toISOString(),
    });
    apiResponse({ res, message: 'Garson çağrıldı' });
  } catch (error) {
    next(error);
  }
}
