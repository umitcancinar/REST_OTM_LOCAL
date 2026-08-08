// ==========================================
// Table Types
// ==========================================

export enum TableStatus {
  AVAILABLE = 'AVAILABLE',
  OCCUPIED = 'OCCUPIED',
  RESERVED = 'RESERVED',
  CLEANING = 'CLEANING',
}

export interface Table {
  id: string;
  tenantId: string;
  number: number;
  zone: string; // e.g. "Salon", "Bahçe", "Teras"
  capacity: number;
  status: TableStatus;
  positionX?: number; // For floor plan (kroki)
  positionY?: number;
  currentOrderId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTableDTO {
  number: number;
  zone: string;
  capacity: number;
  positionX?: number;
  positionY?: number;
}

export interface UpdateTableDTO extends Partial<CreateTableDTO> {
  status?: TableStatus;
}
