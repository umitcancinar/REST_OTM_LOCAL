import { randomBytes, randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createPendingDemo, setPendingDemoCookie } from "@/lib/demo-verification";
import { sendVerificationEmail } from "@/lib/demo-mail";

export const runtime = "nodejs";

function redirect(req: NextRequest, stage: "form" | "verify" | "error", message?: string) {
  const url = new URL("/", req.url);
  url.hash = "demo";
  if (stage !== "form") url.searchParams.set("demo", stage);
  if (message) url.searchParams.set("message", message);
  return NextResponse.redirect(url, 303);
}

function value(form: FormData, key: string) { const item = form.get(key); return typeof item === "string" ? item.trim() : ""; }

export async function GET(req: NextRequest) { return redirect(req, "form"); }

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const name = value(form, "name"), restaurant = value(form, "restaurant"), email = value(form, "email").toLowerCase(), phone = value(form, "phone"), city = value(form, "city"), message = value(form, "message");
  if (!name || !restaurant || !email || !phone) return redirect(req, "error", "Ad, restoran adı, e-posta ve telefon zorunludur.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return redirect(req, "error", "Geçerli bir e-posta adresi girin.");
  if (phone.replace(/\D/g, "").length < 10) return redirect(req, "error", "Telefon numarası geçerli görünmüyor.");
  if (!process.env.RESEND_API_KEY || !process.env.DEMO_EMAIL_FROM || !process.env.DEMO_NOTIFICATION_EMAIL || !process.env.DEMO_VERIFICATION_SECRET) return redirect(req, "error", "E-posta doğrulama servisi henüz yapılandırılmadı. Lütfen kısa süre sonra tekrar deneyin.");
  const code = String(randomInt(100000, 1_000_000));
  const pending = createPendingDemo({ id: randomBytes(18).toString("hex"), code, name: name.slice(0, 120), restaurant: restaurant.slice(0, 160), email, phone: phone.slice(0, 32), city: city.slice(0, 80), message: message.slice(0, 1000) });
  try { await sendVerificationEmail({ to: email, code, id: pending.id }); } catch (error) { console.error("[demo-request] verification email failed", error); return redirect(req, "error", "Doğrulama e-postası gönderilemedi. Lütfen tekrar deneyin."); }
  const response = redirect(req, "verify");
  setPendingDemoCookie(response, pending);
  return response;
}
