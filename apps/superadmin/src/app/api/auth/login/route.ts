import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ControlApiProtocolError,
  ControlApiUnavailableError,
  controlApiUrl,
  readControlApiJson,
  waitForControlApiReady,
} from "@/lib/control-api";
import { AdminMailError, adminMailUserMessage, sendAdminVerificationEmail } from "@/lib/server-mail";
import { createPendingMfa, setPendingMfa } from "@/lib/server-session";
import { mutationRequestError } from "@/lib/request-security";
import { verifyTurnstile } from "@/lib/turnstile";

export const runtime = "nodejs";
function clientRateKey(req: NextRequest) { const secret = process.env.SUPERADMIN_BFF_SERVICE_SECRET!; const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown"; return createHmac("sha256", secret).update(forwarded).digest("hex"); }
export async function POST(req: NextRequest) {
  const originError = mutationRequestError(req);
  if (originError) return NextResponse.json({ message: originError }, { status: 403 });

  try {
    const { email, password, turnstileToken } = await req.json();
    if (typeof email !== "string" || typeof password !== "string") return NextResponse.json({ message: "E-posta ve parola zorunludur." }, { status: 400 });
    if (!process.env.RESEND_API_KEY || !process.env.SUPERADMIN_EMAIL_FROM || !process.env.SUPERADMIN_SESSION_SECRET || !process.env.SUPERADMIN_BFF_SERVICE_SECRET) return NextResponse.json({ message: "Yönetici doğrulama servisi yapılandırılmadı." }, { status: 503 });

    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded || req.headers.get("x-real-ip") || "unknown";
    const challenge = await verifyTurnstile(
      typeof turnstileToken === "string" ? turnstileToken : "",
      ip,
    );
    if (!challenge.ok) {
      console.warn("[superadmin-turnstile]", challenge.reason);
      const unavailable = challenge.reason === "service-unconfigured" || challenge.reason === "siteverify-unavailable";
      return NextResponse.json(
        { message: unavailable ? "Güvenlik doğrulama servisi geçici olarak kullanılamıyor." : "Güvenlik doğrulaması başarısız. Lütfen tekrar deneyin." },
        { status: unavailable ? 503 : 400 },
      );
    }

    await waitForControlApiReady();
    const upstream = await fetch(controlApiUrl("auth/superadmin/mfa/start"), { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": req.headers.get("user-agent") || "REST_OTM Superadmin", "x-rest-otm-service-secret": process.env.SUPERADMIN_BFF_SERVICE_SECRET, "x-rest-otm-client-key": clientRateKey(req) }, body: JSON.stringify({ email, password }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
    const payload = await readControlApiJson<{ message?: string; data?: { challengeId?: string; code?: string; expiresAt?: string; email?: string; emailHint?: string } }>(upstream, "superadmin-mfa-start");
    if (!upstream.ok) return NextResponse.json({ message: payload?.message || "E-posta, parola veya doğrulama bilgisi hatalı." }, { status: upstream.status });
    const data = payload.data;
    if (!data?.challengeId || !data?.code || !data?.expiresAt || !data?.email) return NextResponse.json({ message: "Doğrulama servisi geçersiz yanıt verdi." }, { status: 502 });
    const pending = createPendingMfa({ id: data.challengeId, expiresAt: data.expiresAt });
    await sendAdminVerificationEmail({ to: data.email, code: data.code, id: pending.id });
    const response = NextResponse.json({ success: true, requiresVerification: true, emailHint: data.emailHint });
    setPendingMfa(response, pending);
    return response;
  } catch (error) {
    if (error instanceof AdminMailError) {
      return NextResponse.json(
        { message: adminMailUserMessage(error) },
        { status: 503 },
      );
    }
    if (error instanceof ControlApiUnavailableError) {
      return NextResponse.json(
        { code: "CONTROL_API_UNAVAILABLE", message: "Kontrol sunucusu şu anda hazır değil. Lütfen kısa bir süre sonra tekrar deneyin." },
        { status: 503 },
      );
    }
    if (error instanceof ControlApiProtocolError) {
      return NextResponse.json(
        { code: "CONTROL_API_BAD_RESPONSE", message: "Kontrol sunucusu geçersiz yanıt verdi. Lütfen kısa bir süre sonra tekrar deneyin." },
        { status: 502 },
      );
    }
    console.error("[superadmin-login]", error);
    return NextResponse.json({ code: "LOGIN_START_FAILED", message: "Giriş doğrulaması başlatılamadı." }, { status: 502 });
  }
}
