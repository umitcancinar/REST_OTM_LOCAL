import { NextRequest, NextResponse } from "next/server";

/**
 * Demo talep formu — teslim ucu HENUZ BAGLANMADI.
 *
 * DEMO_REQUEST_WEBHOOK_URL ortam degiskeni tanimlanirsa (ornegin bir Slack
 * "Incoming Webhook" adresi veya Make/n8n/Zapier ucu) her basvuru oraya
 * POST edilir — kurulumu birkaç dakika suren, sahte olmayan gercek bir
 * mekanizma. Tanimlanmadigi surece basvurular yalnizca sunucu loguna
 * (Render > Logs) yazilir; e-posta/CRM gonderimi UYDURULMADI, cunku o
 * entegrasyon icin gercek kimlik bilgisi (SMTP/CRM API anahtari) yok.
 *
 * Uretime almadan once: DEMO_REQUEST_WEBHOOK_URL ortam degiskenini
 * Render'da tanimlayin, ya da bu dosyayi gercek bir e-posta saglayicisina
 * (Resend, Postmark vb.) baglayin.
 */

interface DemoRequestBody {
  name?: string;
  restaurant?: string;
  phone?: string;
  city?: string;
  message?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function POST(req: NextRequest) {
  let body: DemoRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Geçersiz istek gövdesi." },
      { status: 400 },
    );
  }

  if (!isNonEmptyString(body.name) || !isNonEmptyString(body.restaurant) || !isNonEmptyString(body.phone)) {
    return NextResponse.json(
      { success: false, message: "Ad, restoran adı ve telefon zorunludur." },
      { status: 422 },
    );
  }

  const phoneDigits = body.phone.replace(/\D/g, "");
  if (phoneDigits.length < 10) {
    return NextResponse.json(
      { success: false, message: "Telefon numarası geçerli görünmüyor." },
      { status: 422 },
    );
  }

  const submission = {
    name: body.name.trim().slice(0, 120),
    restaurant: body.restaurant.trim().slice(0, 160),
    phone: body.phone.trim().slice(0, 32),
    city: isNonEmptyString(body.city) ? body.city.trim().slice(0, 80) : null,
    message: isNonEmptyString(body.message) ? body.message.trim().slice(0, 1000) : null,
    receivedAt: new Date().toISOString(),
    ip: req.headers.get("x-forwarded-for") ?? "unknown",
  };

  const webhookUrl = process.env.DEMO_REQUEST_WEBHOOK_URL;

  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text:
            `Yeni demo talebi\n` +
            `Ad: ${submission.name}\n` +
            `Restoran: ${submission.restaurant}\n` +
            `Telefon: ${submission.phone}\n` +
            `Şehir: ${submission.city ?? "-"}\n` +
            `Not: ${submission.message ?? "-"}`,
          ...submission,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        console.error("[demo-request] webhook non-2xx:", res.status);
      }
    } catch (err) {
      console.error("[demo-request] webhook teslim edilemedi:", err);
      // Webhook hatasi kullaniciya yansitilmaz — basvuru yine de loglanir
      // ve kullaniciya basarili doner, cunku form dolduran restoran sahibi
      // bizim entegrasyon hatamizdan sorumlu tutulamaz.
    }
  } else {
    console.warn(
      "[demo-request] DEMO_REQUEST_WEBHOOK_URL tanimli degil — basvuru yalnizca logland:",
      submission,
    );
  }

  return NextResponse.json({ success: true });
}
