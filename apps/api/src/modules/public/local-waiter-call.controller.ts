import { NextFunction, Request, Response } from 'express';
import { prisma } from '../../config/database';
import { getIO } from '../../websocket/socket.server';
import { apiError, apiResponse } from '../../utils/apiResponse';
import { TableQrTokenService } from './table-qr-token.service';

export function createCallLocalWaiter(tokenService: TableQrTokenService) {
  return async function callLocalWaiter(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const slug = String(req.params.slug || '');
      const body = req.body as { tableId?: unknown; tableToken?: unknown };
      const tableId = typeof body?.tableId === 'string' ? body.tableId : '';
      const tableToken = typeof body?.tableToken === 'string' ? body.tableToken : '';
      if (!tableId || !tableToken || !tokenService.verify(tableToken, slug, tableId)) {
        apiError(res, 404, 'Masa bulunamadı.');
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
  };
}
