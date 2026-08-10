import { createHash } from "node:crypto";

const FORM_WINDOW_MS = 15 * 60 * 1000;
const FORM_MAX_PER_IP = 12;
const FORM_COOLDOWN_MS = 2_000;
const SEND_WINDOW_MS = 60 * 60 * 1000;
const SEND_MAX_PER_IP = 5;
const SEND_MAX_PER_EMAIL = 3;
const SEND_EMAIL_COOLDOWN_MS = 60_000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_RATE_KEYS = 10_000;

type ChallengeStatus = "pending" | "processing" | "consumed";
type Challenge = { attempts: number; expiresAt: number; status: ChallengeStatus };
type Store = {
  formByIp: Map<string, number[]>;
  sendByIp: Map<string, number[]>;
  sendByEmail: Map<string, number[]>;
  challenges: Map<string, Challenge>;
};

const globalStore = globalThis as typeof globalThis & { __restOtmDemoSecurityStore?: Store };
const store = globalStore.__restOtmDemoSecurityStore ??= {
  formByIp: new Map(),
  sendByIp: new Map(),
  sendByEmail: new Map(),
  challenges: new Map(),
};

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };
export type ChallengeClaim =
  | { ok: true }
  | { ok: false; reason: "missing" | "expired" | "busy" | "consumed" | "invalid" | "attempts"; remaining: number };

function fingerprint(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("base64url");
}

function boundedSet<T>(map: Map<string, T>, key: string, value: T) {
  if (!map.has(key) && map.size >= MAX_RATE_KEYS) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
  map.set(key, value);
}

function activeHits(map: Map<string, number[]>, key: string, now: number, windowMs: number) {
  const hits = (map.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
  if (hits.length) boundedSet(map, key, hits);
  else map.delete(key);
  return hits;
}

function denied(hits: number[], now: number, cooldownMs: number): RateLimitResult | null {
  const last = hits.at(-1);
  if (last !== undefined && now - last < cooldownMs) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((cooldownMs - (now - last)) / 1000)) };
  }
  return null;
}

function windowDenied(hits: number[], max: number, now: number, windowMs: number): RateLimitResult | null {
  if (hits.length < max) return null;
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)) };
}

/** Limits all form posts before an external Turnstile call can be triggered. */
export function takeDemoFormAttempt(ip: string, now = Date.now()): RateLimitResult {
  const key = fingerprint(ip || "unknown");
  const hits = activeHits(store.formByIp, key, now, FORM_WINDOW_MS);
  const cooldown = denied(hits, now, FORM_COOLDOWN_MS);
  if (cooldown) return cooldown;
  const limit = windowDenied(hits, FORM_MAX_PER_IP, now, FORM_WINDOW_MS);
  if (limit) return limit;
  hits.push(now);
  boundedSet(store.formByIp, key, hits);
  return { ok: true };
}

/** Called only after Turnstile succeeds, so an attacker cannot lock an arbitrary email. */
export function takeDemoEmailSend(ip: string, email: string, now = Date.now()): RateLimitResult {
  const ipKey = fingerprint(ip || "unknown");
  const emailKey = fingerprint(email);
  const ipHits = activeHits(store.sendByIp, ipKey, now, SEND_WINDOW_MS);
  const emailHits = activeHits(store.sendByEmail, emailKey, now, SEND_WINDOW_MS);
  const emailCooldown = denied(emailHits, now, SEND_EMAIL_COOLDOWN_MS);
  if (emailCooldown) return emailCooldown;
  const ipLimit = windowDenied(ipHits, SEND_MAX_PER_IP, now, SEND_WINDOW_MS);
  if (ipLimit) return ipLimit;
  const emailLimit = windowDenied(emailHits, SEND_MAX_PER_EMAIL, now, SEND_WINDOW_MS);
  if (emailLimit) return emailLimit;
  ipHits.push(now);
  emailHits.push(now);
  boundedSet(store.sendByIp, ipKey, ipHits);
  boundedSet(store.sendByEmail, emailKey, emailHits);
  return { ok: true };
}

function pruneChallenges(now: number) {
  for (const [id, challenge] of store.challenges) {
    if (now > challenge.expiresAt + 10 * 60 * 1000) store.challenges.delete(id);
  }
}

export function registerDemoChallenge(id: string, expiresAt: number, now = Date.now()) {
  pruneChallenges(now);
  boundedSet(store.challenges, id, { attempts: 0, expiresAt, status: "pending" });
}

export function cancelDemoChallenge(id: string) {
  store.challenges.delete(id);
}

/** Atomically checks the authoritative attempt counter and claims a valid code. */
export function claimDemoChallenge(id: string, codeMatches: boolean, now = Date.now()): ChallengeClaim {
  const challenge = store.challenges.get(id);
  if (!challenge) return { ok: false, reason: "missing", remaining: 0 };
  if (now > challenge.expiresAt) return { ok: false, reason: "expired", remaining: 0 };
  if (challenge.status === "processing") return { ok: false, reason: "busy", remaining: 0 };
  if (challenge.status === "consumed") return { ok: false, reason: "consumed", remaining: 0 };
  if (challenge.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, reason: "attempts", remaining: 0 };
  if (!codeMatches) {
    challenge.attempts += 1;
    const remaining = Math.max(0, MAX_CODE_ATTEMPTS - challenge.attempts);
    return { ok: false, reason: remaining ? "invalid" : "attempts", remaining };
  }
  challenge.status = "processing";
  return { ok: true };
}

export function finishDemoChallenge(id: string, success: boolean) {
  const challenge = store.challenges.get(id);
  if (!challenge || challenge.status !== "processing") return;
  challenge.status = success ? "consumed" : "pending";
}

export function clientIp(headers: Headers) {
  const value = headers.get("cf-connecting-ip")
    ?? headers.get("x-forwarded-for")?.split(",")[0]
    ?? headers.get("x-real-ip")
    ?? "unknown";
  return value.trim().slice(0, 64) || "unknown";
}

export function resetDemoSecurityForTests() {
  store.formByIp.clear();
  store.sendByIp.clear();
  store.sendByEmail.clear();
  store.challenges.clear();
}
