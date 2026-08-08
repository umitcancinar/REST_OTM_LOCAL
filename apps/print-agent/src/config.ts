// ==========================================
// Print Agent Configuration
// ==========================================

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: process.env.PRINT_AGENT_ENV_FILE || path.resolve(__dirname, '../../../.env') });

function readPort(value: string | undefined, fallback = 9100): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

export const config = {
  wsUrl: process.env.PRINT_AGENT_WS_URL || 'http://localhost:4000',
  secret: process.env.PRINT_AGENT_SECRET || 'print-agent-secret',
  tenantId: process.env.PRINT_AGENT_TENANT_ID || 'default-tenant-id', // MUST be set in production
  reconnectInterval: 5000,

  // ─── Fiziksel Yazıcı IP Adresleri ──────────────────────────────
  // Fırın (KITCHEN) → 192.168.1.203:9100
  // Izgara (GRILL)  → 192.168.1.202:9100
  // Adisyon (CASHIER) → 192.168.1.128:9100
  // ───────────────────────────────────────────────────────────────
  printers: {
    'Adisyon':         { type: 'network', ip: process.env.CASHIER_PRINTER_IP || '192.168.1.128', port: readPort(process.env.CASHIER_PRINTER_PORT) },
    'Kasa Yazıcısı':   { type: 'network', ip: process.env.CASHIER_PRINTER_IP || '192.168.1.128', port: readPort(process.env.CASHIER_PRINTER_PORT) },
    'Fırın Yazıcısı':  { type: 'network', ip: process.env.KITCHEN_PRINTER_IP || '192.168.1.203', port: readPort(process.env.KITCHEN_PRINTER_PORT) },
    'Izgara Yazıcısı': { type: 'network', ip: process.env.GRILL_PRINTER_IP || '192.168.1.202', port: readPort(process.env.GRILL_PRINTER_PORT) },
    // Legacy aliases — kept for backward compatibility
    'Mutfak Yazıcısı': { type: 'network', ip: process.env.KITCHEN_PRINTER_IP || '192.168.1.203', port: readPort(process.env.KITCHEN_PRINTER_PORT) },
  } as Record<string, { type: string; ip?: string; port?: number }>,

  // Sabit IP erişimi (WebSocket event içinde de kullanılır)
  printerIPs: {
    KITCHEN: { ip: process.env.KITCHEN_PRINTER_IP || '192.168.1.203', port: readPort(process.env.KITCHEN_PRINTER_PORT) },
    GRILL:   { ip: process.env.GRILL_PRINTER_IP   || '192.168.1.202', port: readPort(process.env.GRILL_PRINTER_PORT) },
  },
};
