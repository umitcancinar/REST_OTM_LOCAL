import { NextRequest, NextResponse } from "next/server";
import { mutationRequestError } from "@/lib/request-security";
import { clearSession, tokens } from "@/lib/server-session";
export async function POST(req: NextRequest) {
  const originError = mutationRequestError(req);
  if (originError) return NextResponse.json({ message: originError }, { status: 403 });

  const { refreshToken } = tokens(req);
  if (refreshToken && process.env.REST_OTM_API_URL) {
    try {
      await fetch(`${process.env.REST_OTM_API_URL.replace(/\/$/, "")}/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) });
    } catch {
      /* session is still cleared locally */
    }
  }
  const response = NextResponse.json({ success: true });
  clearSession(response);
  return response;
}
