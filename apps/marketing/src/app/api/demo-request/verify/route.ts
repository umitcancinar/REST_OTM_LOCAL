import { NextRequest, NextResponse } from "next/server";
import { clearPendingDemoCookie, getPendingDemo, setPendingDemoCookie, verifyPendingCode } from "@/lib/demo-verification";
import { sendDemoNotifications } from "@/lib/demo-mail";
import { finishDemoChallenge } from "@/lib/demo-security";
import { marketingRedirectUrl } from "@/lib/public-origin";

export const runtime = "nodejs";

function redirect(req: NextRequest, stage: "verify" | "success" | "error", message?: string) { const url = marketingRedirectUrl(req.url); url.hash = "demo"; url.searchParams.set("demo", stage); if (message) url.searchParams.set("message", message); return NextResponse.redirect(url, 303); }

export async function POST(req: NextRequest) {
  const pending = getPendingDemo(req);
  if (!pending) return redirect(req, "error", "Doğrulama oturumunuz sona ermiş. Formu yeniden doldurun.");
  const form = await req.formData();
  const directCode = typeof form.get("code") === "string" ? String(form.get("code")) : "";
  const digitCode = Array.from({ length: 6 }, (_, index) => {
    const digit = form.get(`digit${index}`);
    return typeof digit === "string" ? digit : "";
  }).join("");
  const code = (directCode || digitCode).replace(/\s/g, "");
  const result = verifyPendingCode(pending, code);
  if (!result.ok) { const response = redirect(req, result.expired ? "error" : "verify", result.message); if (!result.expired) setPendingDemoCookie(response, result.pending); else clearPendingDemoCookie(response); return response; }
  try { await sendDemoNotifications(pending); } catch (error) { finishDemoChallenge(pending.id, false); console.error("[demo-request] notification emails failed", error); return redirect(req, "verify", "Talep bildirimi gönderilemedi. Lütfen tekrar deneyin."); }
  finishDemoChallenge(pending.id, true);
  const response = redirect(req, "success"); clearPendingDemoCookie(response); return response;
}
