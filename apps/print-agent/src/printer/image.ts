import Jimp from 'jimp';
import { lookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';

/**
 * SSRF korumasi: bir hostname'in ic aga (LAN/loopback/link-local) isaret
 * edip etmedigini kontrol eder. Admin panelinden girilen logo URL'i, bu
 * yerel agdaki print-agent tarafindan indirildigi icin (kullanicinin kendi
 * makinesi degil, restorandaki bilgisayar) korumasiz birakilirsa kotu
 * niyetli bir logo URL'i ile router/kamera gibi ic ag cihazlarina istek
 * attirilabilir.
 */
function isPrivateAddress(address: string): boolean {
  if (isIPv4(address)) {
    const parts = address.split('.').map(Number);
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    return false;
  }
  if (isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80');
  }
  return false;
}

async function assertPublicUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.hostname === 'localhost') {
    throw new Error('Logo adresi yerel bir adrese işaret edemez');
  }
  const { address } = await lookup(parsed.hostname);
  if (isPrivateAddress(address)) {
    throw new Error('Logo adresi yerel ağa işaret edemez');
  }
}

export async function createRasterImageBuffer(url: string, targetWidth = 256, align: 'left' | 'center' | 'right' = 'center'): Promise<Buffer> {
  try {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('Logo adresi http veya https ile başlamalıdır');
    }
    await assertPublicUrl(url);

    let timeout: NodeJS.Timeout | undefined;
    const image = await Promise.race([
      Jimp.read(url),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Logo indirme zaman aşımı')), 5000);
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
    
    // ESC/POS raster rows must be a multiple of eight pixels. Width and height
    // are bounded so malformed images cannot allocate unbounded print buffers.
    const safeWidth = Math.min(576, Math.max(8, Math.round(targetWidth / 8) * 8));
    image.resize(safeWidth, Jimp.AUTO);
    if (image.bitmap.height > 480) {
      image.resize(Math.max(8, Math.round((image.bitmap.width * 480 / image.bitmap.height) / 8) * 8), 480);
    }
    
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    
    // Width must be a multiple of 8 for raster bit image
    const widthBytes = Math.ceil(width / 8);
    
    const xL = widthBytes & 0xff;
    const xH = (widthBytes >> 8) & 0xff;
    const yL = height & 0xff;
    const yH = (height >> 8) & 0xff;
    
    // Header for GS v 0 (raster image)
    const header = Buffer.from([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
    
    const dataSize = widthBytes * height;
    const data = Buffer.alloc(dataSize, 0);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (image.bitmap.width * y + x) << 2;
        const r = image.bitmap.data[idx] || 0;
        const g = image.bitmap.data[idx + 1] || 0;
        const b = image.bitmap.data[idx + 2] || 0;
        const a = image.bitmap.data[idx + 3] || 0;
        
        // Luminance calculation
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
        // Alpha blending with white background
        const finalLum = a < 128 ? 255 : luminance;
        
        // 1 = black dot, 0 = white dot
        if (finalLum < 128) {
          const byteIdx = y * widthBytes + Math.floor(x / 8);
          const bitIdx = 7 - (x % 8);
          if (data && byteIdx < data.length) {
            const currentByte = data[byteIdx] || 0;
            data[byteIdx] = currentByte | (1 << bitIdx);
          }
        }
      }
    }
    
    // Set alignment command based on param
    let alignByte = 0x01; // center
    if (align === 'left') alignByte = 0x00;
    if (align === 'right') alignByte = 0x02;

    const alignCommand = Buffer.from([0x1B, 0x61, alignByte]);
    const lf = Buffer.from([0x0A]);
    
    return Buffer.concat([alignCommand, header, data, lf]);
  } catch (err) {
    console.error('Image processing error:', err);
    return Buffer.alloc(0);
  }
}
