import { NextRequest, NextResponse } from "next/server";
import { mutationRequestError } from "@/lib/request-security";
import { clearSession, pendingMfa, setSession } from "@/lib/server-session";
export const runtime = "nodejs";
function apiBase() { const value = process.env.REST_OTM_API_URL; if (!value) throw new Error("REST_OTM_API_URL is not configured"); return value.replace(/\/$/, ""); }
export async function POST(req: NextRequest) {
  const originError = mutationRequestError(req);
  if (originError) return NextResponse.json({ message: originError }, { status: 403 });

  const pending = pendingMfa(req);
  if (!pending) return NextResponse.json({ message: "Doğrulama oturumu sona erdi. Yeniden giriş yapın." }, { status: 401 });
  try {
    const { code } = await req.json();
    const normalizedCode = typeof code === "string" ? code.replace(/\s/g, "") : "";
    if (!/^\d{6}$/.test(normalizedCode) || !process.env.SUPERADMIN_BFF_SERVICE_SECRET) return NextResponse.json({ message: "6 haneli kodu girin." }, { status: 400 });
    const upstream = await fetch(`${apiBase()}/auth/superadmin/mfa/verify`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": req.headers.get("user-agent") || "REST_OTM Superadmin", "x-rest-otm-service-secret": process.env.SUPERADMIN_BFF_SERVICE_SECRET }, body: JSON.stringify({ challengeId: pending.id, code: normalizedCode }), cache: "no-store" });
    const payload = await upstream.json();
    if (!upstream.ok) {
      const response = NextResponse.json({ message: payload?.message || "Kod doğrulanamadı." }, { status: upstream.status });
      if (upstream.status === 409 || payload?.message?.includes("sona erdi") || payload?.message?.includes("fazla hatalı")) clearSession(response);
      return response;
    }
    const data = payload.data;
    if (!data?.tokens?.accessToken || !data?.tokens?.refreshToken || data?.user?.role !== "SUPER_ADMIN") {
      const response = NextResponse.json({ message: "Doğrulama servisi geçersiz yanıt verdi." }, { status: 502 });
      clearSession(response);
      return response;
    }
    const response = NextResponse.json({ success: true, data: { user: data.user } });
    setSession(response, data.tokens);
    response.cookies.set("rest_otm_sa_mfa", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    console.error("[superadmin-verify]", error);
    return NextResponse.json({ message: "Doğrulama servisine ulaşılamadı." }, { status: 502 });
  }
}
