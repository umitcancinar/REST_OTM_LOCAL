// ==========================================
// Printer Router — Department-Based Routing
// ==========================================

import * as net from 'net';
import { config } from '../config';
import { turkishToCP857 } from './escpos';

const WRITE_CHUNK_BYTES = 1024;
const WRITE_CHUNK_DELAY_MS = 15;
const PRINTER_DRAIN_MS = 750;
const PRINTER_TIMEOUT_MS = 7000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeChunk(client: net.Socket, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    client.write(chunk, (error?: Error | null) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * Send raw ESC/POS data to a network printer.
 * Accepts direct IP/Port (from server event) or falls back to local config lookup.
 */
export async function sendToPrinter(
  printerName: string, 
  data: string | Buffer,
  directIp?: string,
  directPort?: number
): Promise<boolean> {
  // If direct IP/Port provided from server, use them
  if (directIp && directPort) {
    console.log(`📡 Using server-provided address: ${directIp}:${directPort}`);
    return sendToNetworkPrinter(directIp, directPort, data);
  }

  // Fallback to local config
  const printer = config.printers[printerName];

  if (!printer) {
    console.error(`❌ Printer not found in local config: ${printerName}`);
    return false;
  }

  if (printer.type === 'network' && printer.ip && printer.port) {
    return sendToNetworkPrinter(printer.ip, printer.port, data);
  }

  console.warn(`⚠️  Unsupported printer type: ${printer.type}`);
  return false;
}

function sendToNetworkPrinter(ip: string, port: number, data: string | Buffer): Promise<boolean> {
  return new Promise((resolve) => {
    if (net.isIP(ip) === 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`❌ Invalid printer address: ${ip}:${port}`);
      resolve(false);
      return;
    }

    const client = new net.Socket();
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      client.destroy();
      console.error(`❌ Printer timeout: ${ip}:${port}`);
      finish(false);
    }, PRINTER_TIMEOUT_MS);

    client.connect(port, ip, async () => {
      client.setNoDelay(true);
      // ESC/POS verisi: kontrol byte'ları ASCII, Türkçe metin CP857 ile encode edilir.
      // turkishToCP857 her karakteri doğru byte değerine map eder.
      const buffer = Buffer.isBuffer(data) ? data : turkishToCP857(data);

      try {
        // Cheap ESC/POS controllers can acknowledge TCP while silently dropping
        // a large one-shot payload. Pace bounded chunks and leave a drain window
        // so the device consumes the complete receipt before the socket closes.
        for (let offset = 0; offset < buffer.length; offset += WRITE_CHUNK_BYTES) {
          const end = Math.min(offset + WRITE_CHUNK_BYTES, buffer.length);
          await writeChunk(client, buffer.subarray(offset, end));
          if (end < buffer.length) await delay(WRITE_CHUNK_DELAY_MS);
        }

        await delay(PRINTER_DRAIN_MS);
        if (settled) return;
        
        // Önce graceful kapanış (FIN) iste
        client.end();
        // Ucuz (Çin menşeili vb.) yazıcılarda soketin TIME_WAIT/CLOSE_WAIT'te askıda kalıp
        // bir sonraki fişte "ECONNREFUSED" fırlatmasını önlemek için soketi tamamen (RST) yok et.
        setTimeout(() => {
          if (!client.destroyed) client.destroy();
        }, 500);

        console.log(`✅ Sent ${buffer.length} bytes to ${ip}:${port}`);
        finish(true);
      } catch (error) {
        console.error(`❌ Printer write error ${ip}:${port}:`, (error as Error).message);
        client.destroy();
        finish(false);
      }
    });

    client.once('error', (err) => {
      console.error(`❌ Printer error ${ip}:${port}:`, err.message);
      client.destroy();
      finish(false);
    });
  });
}
