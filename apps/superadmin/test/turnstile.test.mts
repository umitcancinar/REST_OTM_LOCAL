import assert from "node:assert/strict";
import test from "node:test";
import { turnstileAction, turnstileSiteKey, verifyTurnstile } from "../src/lib/turnstile.ts";

test("admin Turnstile uses the bound login action", () => {
  assert.equal(turnstileAction(), "superadmin_login");
});

test("admin Turnstile uses test credentials only outside production", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = {
    nodeEnv: env.NODE_ENV,
    siteKey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    secret: env.TURNSTILE_SECRET_KEY,
    hostnames: env.TURNSTILE_ALLOWED_HOSTNAMES,
  };

  try {
    env.NODE_ENV = "development";
    delete env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    assert.equal(turnstileSiteKey(), "1x00000000000000000000AA");

    env.NODE_ENV = "production";
    delete env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete env.TURNSTILE_SECRET_KEY;
    delete env.TURNSTILE_ALLOWED_HOSTNAMES;
    assert.equal(turnstileSiteKey(), null);
    assert.deepEqual(await verifyTurnstile("dummy-token", "203.0.113.10"), {
      ok: false,
      reason: "service-unconfigured",
    });
  } finally {
    if (previous.nodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previous.nodeEnv;
    if (previous.siteKey === undefined) delete env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    else env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = previous.siteKey;
    if (previous.secret === undefined) delete env.TURNSTILE_SECRET_KEY;
    else env.TURNSTILE_SECRET_KEY = previous.secret;
    if (previous.hostnames === undefined) delete env.TURNSTILE_ALLOWED_HOSTNAMES;
    else env.TURNSTILE_ALLOWED_HOSTNAMES = previous.hostnames;
  }
});

test("admin Turnstile rejects missing and oversized tokens before the network", async () => {
  assert.deepEqual(await verifyTurnstile("", "203.0.113.10"), {
    ok: false,
    reason: "missing-or-invalid-token",
  });
  assert.deepEqual(await verifyTurnstile("x".repeat(2049), "203.0.113.10"), {
    ok: false,
    reason: "missing-or-invalid-token",
  });
});
