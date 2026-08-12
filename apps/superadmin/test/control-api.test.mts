import assert from "node:assert/strict";
import test from "node:test";
import {
  ControlApiProtocolError,
  ControlApiUnavailableError,
  controlApiBase,
  controlApiUrl,
  readControlApiJson,
  waitForControlApiReady,
} from "../src/lib/control-api.ts";

test("control API root URL automatically uses the /api prefix", () => {
  assert.equal(controlApiBase("https://control.example.com"), "https://control.example.com/api");
  assert.equal(controlApiBase("https://control.example.com/"), "https://control.example.com/api");
  assert.equal(controlApiBase("https://control.example.com/api/"), "https://control.example.com/api");
});

test("control API endpoint joins safely", () => {
  assert.equal(
    controlApiUrl("/auth/superadmin/mfa/start", "https://control.example.com"),
    "https://control.example.com/api/auth/superadmin/mfa/start",
  );
});

test("control API rejects unsafe or ambiguous base URLs", () => {
  assert.throws(() => controlApiBase("ftp://control.example.com"));
  assert.throws(() => controlApiBase("https://user:pass@control.example.com"));
  assert.throws(() => controlApiBase("https://control.example.com/path"));
  assert.throws(() => controlApiBase("https://control.example.com?x=1"));
  assert.throws(() => controlApiBase("https://control.example.com#fragment"));
});

test("control API parser accepts JSON", async () => {
  const response = new Response(JSON.stringify({ data: { ok: true } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  assert.deepEqual(await readControlApiJson(response, "test"), { data: { ok: true } });
});

test("control API parser rejects HTML without exposing the response body", async () => {
  const response = new Response("<!DOCTYPE html><title>secret upstream page</title>", {
    status: 404,
    headers: { "content-type": "text/html" },
  });
  await assert.rejects(
    () => readControlApiJson(response, "test"),
    (error: unknown) => error instanceof ControlApiProtocolError && !error.message.includes("secret upstream page"),
  );
});

test("readiness probe waits through Render HTML 502 and succeeds on JSON readiness", async () => {
  const responses = [
    new Response("<!DOCTYPE html><title>Bad Gateway</title>", {
      status: 502,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
    new Response(JSON.stringify({ success: true, database: "ready" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ];
  const delays: number[] = [];

  await waitForControlApiReady({
    attempts: 2,
    controlApiBaseUrl: "https://control.example.com/api",
    fetchImpl: async () => responses.shift()!,
    wait: async (delayMs) => { delays.push(delayMs); },
  });

  assert.deepEqual(delays, [1_500]);
  assert.equal(responses.length, 0);
});

test("readiness probe rejects an unavailable control API without parsing HTML", async () => {
  await assert.rejects(
    () => waitForControlApiReady({
      attempts: 2,
      controlApiBaseUrl: "https://control.example.com/api",
      fetchImpl: async () => new Response("<html>provider error</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
      wait: async () => undefined,
    }),
    ControlApiUnavailableError,
  );
});
