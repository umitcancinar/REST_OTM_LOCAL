import { randomBytes, randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createPendingDemo, setPendingDemoCookie } from "@/lib/demo-verification";
import { sendVerificationEmail } from "@/lib/demo-mail";
import { parseDemoInput } from "@/lib/demo-input";
import { cancelDemoChallenge, clientIp, registerDemoChallenge, takeDemoEmailSend, takeDemoFormAttempt } from "@/lib/demo-security";
import { verifyTurnstile } from "@/lib/turnstile";

export const runtime = "nodejs";
const MAX_FORM_BYTES = 16_384;

function redirect(req: NextRequest, stage: "form" | "verify" | "error", message?: string, retryAfter?: number) {
  const url = new URL("/", req.url);
  url.hash = "demo";
  if (stage !== "form") url.searchParams.set("demo", stage);
  if (message) url.searchParams.set("message", message);
  const response = NextResponse.redirect(url, 303);
  if (retryAfter) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

export async function GET(req: NextRequest) { return redirect(req, "form"); }

async function readForm(req: NextRequest) {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) return null;
  const reader = req.body?.getReader();
  if (!reader) return new FormData();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FORM_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const params = new URLSearchParams(new TextDecoder().decode(bytes));
  const form = new FormData();
  for (const [key, value] of params) form.append(key, value);
  return form;
}

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_FORM_BYTES) return redirect(req, "error", "Form verisi izin verilen boyutu aşıyor.");
  const ip = clientIp(req.headers);
  const formLimit = takeDemoFormAttempt(ip);
  if (!formLimit.ok) return redirect(req, "error", `Çok hızlı deneme yapıldı. ${formLimit.retryAfterSeconds} saniye sonra tekrar deneyin.`, formLimit.retryAfterSeconds);
  const form = await readForm(req);
  if (!form) return redirect(req, "error", "Form biçimi veya boyutu geçersiz.");
  const parsed = parseDemoInput(form);
  if (!parsed.ok) return redirect(req, "error", parsed.message);
  const { name, restaurant, email, phone, city, message } = parsed.value;
  if (!process.env.RESEND_API_KEY || !process.env.DEMO_EMAIL_FROM || !process.env.DEMO_NOTIFICATION_EMAIL || !process.env.DEMO_VERIFICATION_SECRET) return redirect(req, "error", "E-posta doğrulama servisi henüz yapılandırılmadı. Lütfen kısa süre sonra tekrar deneyin.");
  const turnstileToken = form.get("cf-turnstile-response");
  const challenge = await verifyTurnstile(typeof turnstileToken === "string" ? turnstileToken : "", ip);
  if (!challenge.ok) {
    console.warn("[demo-request] Turnstile rejected", { reason: challenge.reason });
    return redirect(req, "error", "Güvenlik doğrulaması tamamlanamadı. Kutuyu yenileyip tekrar deneyin.");
  }
  const sendLimit = takeDemoEmailSend(ip, email);
  if (!sendLimit.ok) return redirect(req, "error", `Bu adres için kısa süre önce kod gönderildi. ${sendLimit.retryAfterSeconds} saniye sonra tekrar deneyin.`, sendLimit.retryAfterSeconds);
  const code = String(randomInt(100000, 1_000_000));
  const pending = createPendingDemo({ id: randomBytes(18).toString("hex"), code, name, restaurant, email, phone, city, message });
  registerDemoChallenge(pending.id, pending.expiresAt);
  try { await sendVerificationEmail({ to: email, code, id: pending.id }); } catch (error) { cancelDemoChallenge(pending.id); console.error("[demo-request] verification email failed", error); return redirect(req, "error", "Doğrulama e-postası gönderilemedi. Lütfen tekrar deneyin."); }
  const response = redirect(req, "verify");
  setPendingDemoCookie(response, pending);
  return response;
}
