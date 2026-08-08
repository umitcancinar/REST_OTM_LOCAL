// ==========================================
// WebSocket Event Contracts
// ==========================================
// Both client and server use these event names
// to ensure type-safe real-time communication.

/** Client → Server events */
export interface ClientToServerEvents {
  // Auth
  'auth:join': (data: { tenantId: string; userId: string; role: string }) => void;
  'auth:leave': () => void;

  // Orders
  'order:create': (data: { order: unknown; localId?: string }) => void;
  'order:update_status': (data: { orderId: string; status: string }) => void;
  'order:item_status': (data: {
    orderId: string;
    itemId: string;
    status: string;
  }) => void;

  // Tables
  'table:update_status': (data: { tableId: string; status: string }) => void;

  // Print
  'print:request': (data: {
    orderId: string;
    type: 'kitchen' | 'receipt' | 'bar';
  }) => void;

  // Sync (offline orders)
  'sync:offline_orders': (data: { orders: unknown[] }) => void;
}

/** Server → Client events */
export interface ServerToClientEvents {
  // Orders
  'order:new': (data: { order: unknown }) => void;
  'order:updated': (data: { order: unknown }) => void;
  'order:item_updated': (data: {
    orderId: string;
    itemId: string;
    status: string;
  }) => void;

  // Tables
  'table:status_changed': (data: { tableId: string; status: string }) => void;

  // Kitchen / KDS
  'kitchen:new_items': (data: { items: unknown[]; orderId: string; tableNumber: number }) => void;
  'kitchen:item_ready': (data: { itemId: string; orderId: string }) => void;

  // Print
  'print:job': (data: {
    jobId: string;
    printer: string;
    department: string;
    escposData: Buffer | string;
  }) => void;
  'print:result': (data: { jobId: string; success: boolean; error?: string }) => void;

  // Stock alerts
  'inventory:stock_alert': (data: { alerts: unknown[] }) => void;

  // Sync acknowledgement
  'sync:confirmed': (data: { localId: string; serverId: string }) => void;

  // Connection
  'error': (data: { message: string; code: string }) => void;
}

/** Socket.io namespace events for inter-server communication */
export interface InterServerEvents {
  ping: () => void;
}

/** Socket data attached to each connection */
export interface SocketData {
  userId: string;
  tenantId: string;
  role: string;
}
