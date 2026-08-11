import assert from "node:assert/strict";
import test from "node:test";
import {
  ControlApiProtocolError,
  controlApiBase,
  controlApiUrl,
  readControlApiJson,
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
