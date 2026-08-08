import net from 'net';
import os from 'os';

export interface DiscoveredPrinter {
  ip: string;
  port: number;
}

/**
 * Scans the local network for thermal printers on port 9100
 */
export async function discoverPrinters(timeout = 200): Promise<DiscoveredPrinter[]> {
  const interfaces = os.networkInterfaces();
  const found: DiscoveredPrinter[] = [];
  const scanPromises: Promise<void>[] = [];

  console.log('🔍 Ağdaki yazıcılar taranıyor...');

  for (const name of Object.keys(interfaces)) {
    for (const netInterface of interfaces[name]!) {
      if (netInterface.family === 'IPv4' && !netInterface.internal) {
        const baseIp = netInterface.address.split('.').slice(0, 3).join('.');
        
        // Scan the entire subnet (1-254)
        for (let i = 1; i < 255; i++) {
          const ip = `${baseIp}.${i}`;
          scanPromises.push(
            checkPort(ip, 9100, timeout).then((isOpen) => {
              if (isOpen) {
                console.log(`✅ Yazıcı bulundu: ${ip}:9100`);
                found.push({ ip, port: 9100 });
              }
            })
          );
        }
      }
    }
  }

  await Promise.all(scanPromises);
  return found;
}

function checkPort(ip: string, port: number, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = false;

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      status = true;
      socket.destroy();
    });

    socket.on('timeout', () => {
      socket.destroy();
    });

    socket.on('error', () => {
      socket.destroy();
    });

    socket.on('close', () => {
      resolve(status);
    });

    socket.connect(port, ip);
  });
}
