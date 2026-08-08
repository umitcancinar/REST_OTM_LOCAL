import * as net from 'net';

/**
 * GMP3 Protocol Handler for POS Terminals
 */
export class GMP3Handler {
  private static STX = 0x02;
  private static ETX = 0x03;

  /**
   * Calculates the Longitudinal Redundancy Check (LRC)
   */
  private static calculateLRC(data: Buffer): number {
    let lrc = 0;
    for (let i = 0; i < data.length; i++) {
      lrc ^= data[i]!;
    }
    return lrc;
  }

  /**
   * Creates a Sale packet for GMP3
   * Format: STX | LEN(2) | CMD(1) | DATA | ETX | LRC
   */
  public static createSalePacket(amountInCents: number): Buffer {
    // Amount usually formatted as 12 digits (e.g., 000000001000 for 10.00 TL)
    const amountStr = amountInCents.toString().padStart(12, '0');
    const cmd = 0x30; // Sale command code
    const data = Buffer.from(amountStr + '00'); // Adding currency code/decimals if needed

    const body = Buffer.concat([
      Buffer.from([cmd]),
      data
    ]);

    const len = Buffer.alloc(2);
    len.writeUInt16BE(body.length);

    const packetWithoutLRC = Buffer.concat([
      Buffer.from([this.STX]),
      len,
      body,
      Buffer.from([this.ETX])
    ]);

    const lrc = this.calculateLRC(packetWithoutLRC.slice(1)); // LRC usually excludes STX
    
    return Buffer.concat([
      packetWithoutLRC,
      Buffer.from([lrc])
    ]);
  }

  /**
   * Connects to POS and sends a sale request
   */
  public static async startSale(ip: string, port: number, amount: number): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve) => {
      const client = new net.Socket();
      const amountInCents = Math.round(amount * 100);
      const packet = this.createSalePacket(amountInCents);

      const timeout = setTimeout(() => {
        client.destroy();
        resolve({ success: false, message: 'POS Cihazı Zaman Aşımı' });
      }, 30000); // 30 second timeout for user to swap card

      client.connect(port, ip, () => {
        console.log(`💳 POS connected: ${ip}:${port}. Sending sale request for ${amount} TL`);
        client.write(packet);
      });

      client.on('data', (data) => {
        // Basic parsing of response (Success vs Fail)
        // GMP3 responses usually start with STX and have a status code
        console.log('📥 POS Response received:', data.toString('hex'));
        
        clearTimeout(timeout);
        client.end();

        // Very basic success check (this will need refinement based on actual POS protocol docs)
        if (data.includes(0x06)) { // ACK
           resolve({ success: true, message: 'İşlem Başarılı' });
        } else {
           resolve({ success: false, message: 'İşlem Reddedildi veya İptal Edildi' });
        }
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        console.error('❌ POS Connection Error:', err.message);
        resolve({ success: false, message: `Bağlantı Hatası: ${err.message}` });
      });
    });
  }
}
