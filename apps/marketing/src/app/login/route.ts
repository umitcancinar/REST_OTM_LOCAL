import { NextResponse } from "next/server";

const FALLBACK_LOGIN_URL = "https://rest-otm-superadmin.onrender.com/login";
const ALLOWED_LOGIN_HOSTNAMES = new Set([
  "rest-otm-superadmin.onrender.com",
  "yonetim.restoranyonetim.com",
]);

function loginUrl() {
  const configured = process.env.SUPERADMIN_LOGIN_URL?.trim();
  if (!configured) return FALLBACK_LOGIN_URL;

  try {
    const target = new URL(configured);
    if (
      target.protocol !== "https:" ||
      target.username ||
      target.password ||
      !ALLOWED_LOGIN_HOSTNAMES.has(target.hostname.toLowerCase())
    ) {
      return FALLBACK_LOGIN_URL;
    }
    target.pathname = "/login";
    target.search = "";
    target.hash = "";
    return target.toString();
  } catch {
    return FALLBACK_LOGIN_URL;
  }
}

export function GET() {
  const response = NextResponse.redirect(loginUrl(), 307);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}
