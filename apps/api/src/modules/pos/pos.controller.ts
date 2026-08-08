import { Request, Response } from 'express';
import { posService } from './pos.service';
import { logger } from '../../utils/logger';

export const posController = {
  startPayment: async (req: Request, res: Response) => {
    try {
      const { orderId, amount } = req.body;
      const tenantId = (req as any).tenantId;

      if (!orderId || !amount) {
        return res.status(400).json({ message: 'OrderId ve tutar (amount) gereklidir.' });
      }

      const result = await posService.startPayment(tenantId, orderId, amount);
      res.status(200).json(result);
    } catch (error) {
      logger.error('POS Payment Error:', error);
      res.status(500).json({ message: (error as Error).message });
    }
  }
};
