// ==========================================
// Reservation Service
// ==========================================

import prisma from '../../config/database';
import { CreateReservationDTO, UpdateReservationDTO } from '@rest-otm/shared-types';

export const reservationService = {
  async getAll(tenantId: string) {
    return prisma.reservation.findMany({
      where: { tenantId },
      include: { table: true },
      orderBy: { reservationTime: 'asc' },
    });
  },

  async getById(tenantId: string, id: string) {
    const reservation = await prisma.reservation.findFirst({
      where: { id, tenantId },
      include: { table: true },
    });
    if (!reservation) throw { statusCode: 404, message: 'Rezervasyon bulunamadı' };
    return reservation;
  },

  async create(tenantId: string, data: CreateReservationDTO) {
    const resTime = new Date(data.reservationTime);
    const now = new Date();

    if (resTime < now) {
      throw { statusCode: 400, message: 'Geçmiş bir tarihe veya saate rezervasyon yapılamaz.' };
    }
    
    // Çakışma kontrolü: Aynı masaya +/- 2 saat içinde başka bir CONFIRMED rezervasyon var mı?
    const startTime = new Date(resTime.getTime() - 2 * 60 * 60 * 1000);
    const endTime = new Date(resTime.getTime() + 2 * 60 * 60 * 1000);

    const conflict = await prisma.reservation.findFirst({
      where: {
        tenantId,
        tableId: data.tableId,
        status: { in: ['CONFIRMED', 'PENDING'] },
        reservationTime: {
          gte: startTime,
          lte: endTime
        }
      }
    });

    if (conflict) {
      throw { 
        statusCode: 400, 
        message: `Bu masa için ${new Date(conflict.reservationTime).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} saatinde zaten bir rezervasyon mevcut.` 
      };
    }
    
    const reservation = await prisma.reservation.create({
      data: {
        tenantId,
        tableId: data.tableId,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        guestCount: data.guestCount || 2,
        reservationTime: resTime,
        notes: data.notes,
        status: 'PENDING',
      },
      include: { table: true },
    });

    // ÖNEMLİ: Masa durumuna dokunmuyoruz! 
    // Masa fiziksel olarak neyse (AVAILABLE/OCCUPIED) o kalmalı.
    
    return reservation;
  },

  async updateStatus(tenantId: string, id: string, status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED') {
    return prisma.$transaction(async (tx) => {
      const exists = await tx.reservation.findFirst({ where: { id, tenantId } });
      if (!exists) throw { statusCode: 404, message: 'Rezervasyon bulunamadı' };

      const updated = await tx.reservation.update({
        where: { id },
        data: { status },
        include: { table: true },
      });

      // Eğer misafir geldiyse (COMPLETED) masanın fiziksel durumunu da değiştiriyoruz.
      if (status === 'COMPLETED') {
        await tx.restaurantTable.update({
          where: { id: updated.tableId, tenantId },
          data: { status: 'OCCUPIED' }
        });
      }

      return updated;
    });
  },

  async deleteAll(tenantId: string) {
    return prisma.reservation.deleteMany({ where: { tenantId } });
  },

  async delete(tenantId: string, id: string) {
    const exists = await prisma.reservation.findFirst({ where: { id, tenantId } });
    if (!exists) throw { statusCode: 404, message: 'Rezervasyon bulunamadı' };

    return prisma.reservation.delete({ where: { id } });
  },
};
