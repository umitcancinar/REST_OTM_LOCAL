import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "rest_otm_sa_access";
const REFRESH_COOKIE = "rest_otm_sa_refresh";
const PENDING_COOKIE = "rest_otm_sa_mfa";
const MFA_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export type SessionUser = { id: string; email: string; name?: string | null; role: string; tenantId?: string | null; tenant?: unknown };
type PendingMfa = { id: string; codeHash: string; expiresAt: number; attempts: number; accessToken: string; refreshToken: string; user: SessionUser };

function secret() { const value = process.env.SUPERADMIN_SESSION_SECRET; if (!value || value.length < 32) throw new Error("SUPERADMIN_SESSION_SECRET missing or too short"); return value; }
function key() { return createHash("sha256").update(secret()).digest(); }
function encode(value: Buffer) { return value.toString("base64url"); }
function decode(value: string) { return Buffer.from(value, "base64url"); }
function codeHash(id: string, code: string) { return createHmac("sha256", secret()).update(`${id}:${code}`).digest("hex"); }
function seal(value: unknown) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv); const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]); return `${encode(iv)}.${encode(cipher.getAuthTag())}.${encode(ciphertext)}`; }
function open<T>(token: string | undefined): T | null { try { if (!token) return null; const [iv, tag, ciphertext] = token.split("."); if (!iv || !tag || !ciphertext) return null; const decipher = createDecipheriv("aes-256-gcm", key(), decode(iv)); decipher.setAuthTag(decode(tag)); return JSON.parse(Buffer.concat([decipher.update(decode(ciphertext)), decipher.final()]).toString("utf8")) as T; } catch { return null; } }
const options = (maxAge: number) => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", maxAge, priority: "high" as const });

export function setSession(response: NextResponse, tokens: { accessToken: string; refreshToken: string }) { response.cookies.set(ACCESS_COOKIE, tokens.accessToken, options(SESSION_TTL_SECONDS)); response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, options(REFRESH_TTL_SECONDS)); }
export function clearSession(response: NextResponse) { response.cookies.set(ACCESS_COOKIE, "", options(0)); response.cookies.set(REFRESH_COOKIE, "", options(0)); response.cookies.set(PENDING_COOKIE, "", options(0)); }
export function tokens(req: NextRequest) { return { accessToken: req.cookies.get(ACCESS_COOKIE)?.value, refreshToken: req.cookies.get(REFRESH_COOKIE)?.value }; }
export function createPendingMfa(input: { code: string; accessToken: string; refreshToken: string; user: SessionUser }): PendingMfa { const id = randomBytes(18).toString("hex"); return { id, codeHash: codeHash(id, input.code), expiresAt: Date.now() + MFA_TTL_SECONDS * 1000, attempts: 0, accessToken: input.accessToken, refreshToken: input.refreshToken, user: input.user }; }
export function setPendingMfa(response: NextResponse, pending: PendingMfa) { response.cookies.set(PENDING_COOKIE, seal(pending), options(MFA_TTL_SECONDS)); }
export function pendingMfa(req: NextRequest) { return open<PendingMfa>(req.cookies.get(PENDING_COOKIE)?.value); }
export function verifyMfa(pending: PendingMfa, code: string): { ok: true } | { ok: false; pending?: PendingMfa; message: string } { if (Date.now() > pending.expiresAt) return { ok: false, message: "Kodun süresi doldu. Yeniden giriş yapın." }; if (!/^\d{6}$/.test(code)) return { ok: false, pending, message: "6 haneli kodu girin." }; if (pending.attempts >= 5) return { ok: false, message: "Çok fazla hatalı deneme yapıldı. Yeniden giriş yapın." }; const actual = Buffer.from(codeHash(pending.id, code), "hex"), expected = Buffer.from(pending.codeHash, "hex"); if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { ok: false, pending: { ...pending, attempts: pending.attempts + 1 }, message: `Kod doğru değil. ${4 - pending.attempts} deneme hakkınız kaldı.` }; return { ok: true }; }
