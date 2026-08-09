import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

const COOKIE = "rest_otm_demo_pending";
const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
export type PendingDemo = { id: string; name: string; restaurant: string; email: string; phone: string; city: string; message: string; codeHash: string; expiresAt: number; attempts: number; };

function secret() { const value = process.env.DEMO_VERIFICATION_SECRET; if (!value || value.length < 32) throw new Error("DEMO_VERIFICATION_SECRET must be at least 32 characters"); return value; }
function key() { return createHash("sha256").update(secret()).digest(); }
function codeHash(id: string, code: string) { return createHmac("sha256", secret()).update(`${id}:${code}`).digest("hex"); }
function encode(value: Buffer) { return value.toString("base64url"); }
function decode(value: string) { return Buffer.from(value, "base64url"); }

export function createPendingDemo(input: Omit<PendingDemo, "codeHash" | "expiresAt" | "attempts"> & { code: string }): PendingDemo { const { code, ...data } = input; return { ...data, codeHash: codeHash(data.id, code), expiresAt: Date.now() + TTL_MS, attempts: 0 }; }
function seal(pending: PendingDemo) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv); const ciphertext = Buffer.concat([cipher.update(JSON.stringify(pending), "utf8"), cipher.final()]); const tag = cipher.getAuthTag(); return `${encode(iv)}.${encode(tag)}.${encode(ciphertext)}`; }
function unseal(token: string): PendingDemo | null { try { const [iv, tag, ciphertext] = token.split("."); if (!iv || !tag || !ciphertext) return null; const decipher = createDecipheriv("aes-256-gcm", key(), decode(iv)); decipher.setAuthTag(decode(tag)); return JSON.parse(Buffer.concat([decipher.update(decode(ciphertext)), decipher.final()]).toString("utf8")) as PendingDemo; } catch { return null; } }
export function setPendingDemoCookie(response: NextResponse, pending: PendingDemo) { response.cookies.set(COOKIE, seal(pending), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: TTL_MS / 1000 }); }
export function clearPendingDemoCookie(response: NextResponse) { response.cookies.set(COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 }); }
export function getPendingDemo(req: NextRequest) { const raw = req.cookies.get(COOKIE)?.value; return raw ? unseal(raw) : null; }
export function verifyPendingCode(pending: PendingDemo, code: string): { ok: true } | { ok: false; expired: boolean; message: string; pending: PendingDemo } { if (Date.now() > pending.expiresAt) return { ok: false, expired: true, message: "Kodun süresi doldu. Lütfen yeni kod isteyin.", pending }; if (!/^\d{6}$/.test(code)) return { ok: false, expired: false, message: "6 haneli kodu girin.", pending }; if (pending.attempts >= MAX_ATTEMPTS) return { ok: false, expired: true, message: "Çok fazla hatalı deneme yapıldı. Lütfen yeni kod isteyin.", pending }; const received = Buffer.from(codeHash(pending.id, code), "hex"), expected = Buffer.from(pending.codeHash, "hex"); if (received.length !== expected.length || !timingSafeEqual(received, expected)) return { ok: false, expired: false, message: `Kod doğru değil. ${MAX_ATTEMPTS - pending.attempts - 1} deneme hakkınız kaldı.`, pending: { ...pending, attempts: pending.attempts + 1 } }; return { ok: true }; }
