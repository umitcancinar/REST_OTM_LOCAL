import { randomUUID } from "node:crypto";

const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
const ACTION = "demo_request";

type SiteverifyResponse = { success?: boolean; action?: string; hostname?: string; "error-codes"?: string[] };

export function turnstileSiteKey() {
  const configured = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? null : TEST_SITE_KEY;
}

export function turnstileAction() { return ACTION; }

export async function verifyTurnstile(token: string, ip: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!token || token.length > 2048) return { ok: false, reason: "missing-or-invalid-token" };
  const production = process.env.NODE_ENV === "production";
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim() || (production ? "" : TEST_SECRET_KEY);
  const allowedHostnames = new Set((process.env.TURNSTILE_ALLOWED_HOSTNAMES ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
  if (!secret || (production && allowedHostnames.size === 0)) return { ok: false, reason: "service-unconfigured" };

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: ip, idempotency_key: randomUUID() }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, reason: "siteverify-unavailable" };
    const result = await response.json() as SiteverifyResponse;
    if (!result.success) return { ok: false, reason: result["error-codes"]?.join(",") || "challenge-failed" };
    if (production && result.action !== ACTION) return { ok: false, reason: "action-mismatch" };
    if (production && (!result.hostname || !allowedHostnames.has(result.hostname.toLowerCase()))) return { ok: false, reason: "hostname-mismatch" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "siteverify-unavailable" };
  }
}

