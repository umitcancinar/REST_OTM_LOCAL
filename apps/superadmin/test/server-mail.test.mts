import assert from "node:assert/strict";
import test from "node:test";
import {
  AdminMailError,
  adminMailUserMessage,
  sendAdminVerificationEmail,
} from "../src/lib/server-mail.ts";

test("admin mail classifies rejected Resend credentials without reading the body", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.SUPERADMIN_EMAIL_FROM;

  process.env.RESEND_API_KEY = "test-key";
  process.env.SUPERADMIN_EMAIL_FROM = "REST_OTM <security@example.com>";
  globalThis.fetch = async () => new Response("sensitive-provider-body", { status: 403 });

  try {
    await assert.rejects(
      sendAdminVerificationEmail({
        to: "admin@example.com",
        code: "123456",
        id: "test-challenge",
      }),
      (error: unknown) => {
        assert.ok(error instanceof AdminMailError);
        assert.equal(error.failure, "unauthorized");
        assert.equal(error.providerStatus, 403);
        assert.match(adminMailUserMessage(error), /Resend anahtarını/);
        assert.doesNotMatch(error.message, /sensitive-provider-body/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
    if (originalFrom === undefined) delete process.env.SUPERADMIN_EMAIL_FROM;
    else process.env.SUPERADMIN_EMAIL_FROM = originalFrom;
  }
});

test("admin mail reports provider and network failures separately", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.SUPERADMIN_EMAIL_FROM;

  process.env.RESEND_API_KEY = "test-key";
  process.env.SUPERADMIN_EMAIL_FROM = "REST_OTM <security@example.com>";

  try {
    globalThis.fetch = async () => new Response(null, { status: 429 });
    await assert.rejects(
      sendAdminVerificationEmail({ to: "admin@example.com", code: "123456", id: "rate-limit" }),
      (error: unknown) => error instanceof AdminMailError && error.failure === "rate-limited",
    );

    globalThis.fetch = async () => { throw new Error("network unavailable"); };
    await assert.rejects(
      sendAdminVerificationEmail({ to: "admin@example.com", code: "123456", id: "network" }),
      (error: unknown) => error instanceof AdminMailError && error.failure === "unavailable",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
    if (originalFrom === undefined) delete process.env.SUPERADMIN_EMAIL_FROM;
    else process.env.SUPERADMIN_EMAIL_FROM = originalFrom;
  }
});
