import type { NextFunction, Response } from 'express';
import prisma from '../../config/database';
import type { AuthenticatedRequest } from '../../middlewares/auth.middleware';

/**
 * Lisans iptal/uretme gibi control-plane islemlerinde JWT icindeki eski role
 * tek basina guvenilmez. Kullanici pasiflestirildi veya rolu dusurulduyse
 * mevcut access token suresi dolmadan da yetkisi kesilir.
 */
export async function requireCurrentSuperAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user?.userId) {
      res.status(401).json({ success: false, message: 'Kimlik dogrulama gerekli.' });
      return;
    }

    const operator = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { role: true, isActive: true },
    });

    if (!operator?.isActive || operator.role !== 'SUPER_ADMIN') {
      res.status(403).json({ success: false, message: 'Guncel superadmin yetkisi gerekli.' });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}
