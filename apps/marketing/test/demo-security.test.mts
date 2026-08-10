import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { DEMO_INPUT_LIMITS, parseDemoInput } from "../src/lib/demo-input.ts";
import {
  claimDemoChallenge,
  finishDemoChallenge,
  registerDemoChallenge,
  resetDemoSecurityForTests,
  takeDemoEmailSend,
  takeDemoFormAttempt,
} from "../src/lib/demo-security.ts";
import { turnstileSiteKey, verifyTurnstile } from "../src/lib/turnstile.ts";

beforeEach(() => resetDemoSecurityForTests());

describe("demo input validation", () => {
  it("normalizes a valid request", () => {
    const form = new FormData();
    form.set("name", "  Ümit Can  ");
    form.set("restaurant", " Restoran ");
    form.set("email", " OWNER@EXAMPLE.COM ");
    form.set("phone", "+90 555 555 55 55");
    const result = parseDemoInput(form);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.email, "owner@example.com");
  });

  it("rejects oversized and header-injection-like input", () => {
    const oversized = new FormData();
    oversized.set("name", "a".repeat(DEMO_INPUT_LIMITS.name + 1));
    oversized.set("restaurant", "R");
    oversized.set("email", "a@example.com");
    oversized.set("phone", "05555555555");
    assert.equal(parseDemoInput(oversized).ok, false);

    const injected = new FormData();
    injected.set("name", "Name\r\nBcc: victim@example.com");
    injected.set("restaurant", "R");
    injected.set("email", "a@example.com");
    injected.set("phone", "05555555555");
    assert.equal(parseDemoInput(injected).ok, false);
  });
});

describe("server-side demo throttles", () => {
  it("enforces a short IP cooldown before Turnstile", () => {
    assert.deepEqual(takeDemoFormAttempt("203.0.113.1", 1_000), { ok: true });
    assert.deepEqual(takeDemoFormAttempt("203.0.113.1", 1_500), { ok: false, retryAfterSeconds: 2 });
    assert.deepEqual(takeDemoFormAttempt("203.0.113.1", 3_000), { ok: true });
  });

  it("does not let invalid captcha traffic lock an email and limits verified sends", () => {
    assert.deepEqual(takeDemoEmailSend("203.0.113.1", "owner@example.com", 1_000), { ok: true });
    assert.deepEqual(takeDemoEmailSend("203.0.113.2", "owner@example.com", 20_000), { ok: false, retryAfterSeconds: 41 });
    assert.deepEqual(takeDemoEmailSend("203.0.113.2", "other@example.com", 20_000), { ok: true });
  });

  it("enforces the hourly email ceiling independently of cooldown", () => {
    assert.deepEqual(takeDemoEmailSend("203.0.113.1", "owner@example.com", 0), { ok: true });
    assert.deepEqual(takeDemoEmailSend("203.0.113.1", "owner@example.com", 60_000), { ok: true });
    assert.deepEqual(takeDemoEmailSend("203.0.113.1", "owner@example.com", 120_000), { ok: true });
    const fourth = takeDemoEmailSend("203.0.113.1", "owner@example.com", 180_000);
    assert.equal(fourth.ok, false);
  });
});

describe("Turnstile configuration", () => {
  it("uses official test credentials only outside production and fails closed in production", async () => {
    const env = process.env as Record<string, string | undefined>;
    const previousNodeEnv = env.NODE_ENV;
    const previousSiteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const previousSecret = env.TURNSTILE_SECRET_KEY;
    const previousHosts = env.TURNSTILE_ALLOWED_HOSTNAMES;
    try {
      env.NODE_ENV = "development";
      delete env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
      assert.equal(turnstileSiteKey(), "1x00000000000000000000AA");
      env.NODE_ENV = "production";
      delete env.TURNSTILE_SECRET_KEY;
      delete env.TURNSTILE_ALLOWED_HOSTNAMES;
      assert.equal(turnstileSiteKey(), null);
      assert.deepEqual(await verifyTurnstile("dummy-token", "203.0.113.1"), { ok: false, reason: "service-unconfigured" });
    } finally {
      if (previousNodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = previousNodeEnv;
      if (previousSiteKey === undefined) delete env.NEXT_PUBLIC_TURNSTILE_SITE_KEY; else env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = previousSiteKey;
      if (previousSecret === undefined) delete env.TURNSTILE_SECRET_KEY; else env.TURNSTILE_SECRET_KEY = previousSecret;
      if (previousHosts === undefined) delete env.TURNSTILE_ALLOWED_HOSTNAMES; else env.TURNSTILE_ALLOWED_HOSTNAMES = previousHosts;
    }
  });
});

describe("authoritative verification state", () => {
  it("cannot reset attempts by replaying an older encrypted cookie", () => {
    registerDemoChallenge("request-1", 100_000, 0);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = claimDemoChallenge("request-1", false, 1_000 + attempt);
      assert.equal(result.ok, false);
    }
    const last = claimDemoChallenge("request-1", false, 2_000);
    assert.deepEqual(last, { ok: false, reason: "attempts", remaining: 0 });
    assert.deepEqual(claimDemoChallenge("request-1", true, 3_000), { ok: false, reason: "attempts", remaining: 0 });
  });

  it("locks concurrent success and permits a retry only after delivery failure", () => {
    registerDemoChallenge("request-2", 100_000, 0);
    assert.deepEqual(claimDemoChallenge("request-2", true, 1_000), { ok: true });
    assert.deepEqual(claimDemoChallenge("request-2", true, 1_001), { ok: false, reason: "busy", remaining: 0 });
    finishDemoChallenge("request-2", false);
    assert.deepEqual(claimDemoChallenge("request-2", true, 1_002), { ok: true });
    finishDemoChallenge("request-2", true);
    assert.deepEqual(claimDemoChallenge("request-2", true, 1_003), { ok: false, reason: "consumed", remaining: 0 });
  });
});
