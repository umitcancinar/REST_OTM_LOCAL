// ==========================================
// Reservation Types
// ==========================================

export enum ReservationStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

export interface Reservation {
  id: string;
  tenantId: string;
  tableId: string;
  customerName: string;
  customerPhone?: string;
  guestCount: number;
  reservationTime: Date;
  status: ReservationStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReservationDTO {
  tableId: string;
  customerName: string;
  customerPhone?: string;
  guestCount?: number;
  reservationTime: string | Date;
  notes?: string;
}

export interface UpdateReservationDTO {
  customerName?: string;
  customerPhone?: string;
  guestCount?: number;
  reservationTime?: string | Date;
  status?: ReservationStatus;
  notes?: string;
}
