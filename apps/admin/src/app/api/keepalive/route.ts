// ==========================================
// Keep-Alive Cron Job Route
// ==========================================
// Vercel Cron tarafından her 14 dakikada bir çağrılır.
// Render.com free tier'ı 15 dakika hareketsizlikte uyutur —
// bu route API'ye ping atarak bunu engeller.

import { NextResponse } from 'next/server';

export const runtime = 'edge';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://rets-otm.onrender.com/api';

export async function GET() {
  const start = Date.now();

  try {
    const res = await fetch(`${API_URL}/health`, {
      method: 'GET',
      headers: { 'User-Agent': 'REST-OTM-Keepalive/1.0' },
      // 10 saniye timeout
      signal: AbortSignal.timeout(10_000),
    });

    const elapsed = Date.now() - start;

    if (res.ok) {
      return NextResponse.json({
        success: true,
        message: 'API sunucusu aktif',
        responseTime: `${elapsed}ms`,
        timestamp: new Date().toISOString(),
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          message: 'API sunucusu yanıt vermedi',
          status: res.status,
          responseTime: `${elapsed}ms`,
          timestamp: new Date().toISOString(),
        },
        { status: 502 }
      );
    }
  } catch (error) {
    const elapsed = Date.now() - start;
    return NextResponse.json(
      {
        success: false,
        message: 'API sunucusuna ulaşılamadı',
        error: error instanceof Error ? error.message : 'Bilinmeyen hata',
        responseTime: `${elapsed}ms`,
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
