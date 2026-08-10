import assert from "node:assert/strict";
import test from "node:test";
import { mutationRequestError, type MutationRequest } from "../src/lib/request-security.ts";

function request({
  method = "POST",
  origin,
  host = "panel.restoranyonetim.com",
  forwardedHost,
  forwardedProto = "https",
  fetchSite = "same-origin",
}: {
  method?: string;
  origin?: string;
  host?: string;
  forwardedHost?: string;
  forwardedProto?: string;
  fetchSite?: string;
} = {}): MutationRequest {
  const values = new Map<string, string>();
  if (origin) values.set("origin", origin);
  if (host) values.set("host", host);
  if (forwardedHost) values.set("x-forwarded-host", forwardedHost);
  if (forwardedProto) values.set("x-forwarded-proto", forwardedProto);
  if (fetchSite) values.set("sec-fetch-site", fetchSite);

  return {
    method,
    headers: { get: (name) => values.get(name.toLowerCase()) ?? null },
    nextUrl: { origin: `https://${host}` },
  };
}

test("safe reads do not require an Origin header", () => {
  assert.equal(mutationRequestError(request({ method: "GET", fetchSite: "cross-site" }), []), null);
});

test("same-origin state changes are accepted", () => {
  assert.equal(
    mutationRequestError(request({ origin: "https://panel.restoranyonetim.com" }), []),
    null,
  );
});

test("Render proxy host and protocol are used for the public origin", () => {
  assert.equal(
    mutationRequestError(
      request({
        host: "internal:10000",
        forwardedHost: "panel.restoranyonetim.com",
        origin: "https://panel.restoranyonetim.com",
      }),
      [],
    ),
    null,
  );
});

test("missing and malformed Origin headers are rejected", () => {
  assert.match(mutationRequestError(request(), []) ?? "", /doğrulanamadı/);
  assert.match(mutationRequestError(request({ origin: "not-an-origin" }), []) ?? "", /Geçersiz/);
});

test("foreign origins and explicit cross-site requests are rejected", () => {
  assert.match(
    mutationRequestError(request({ origin: "https://attacker.example" }), []) ?? "",
    /eşleşmiyor/,
  );
  assert.match(
    mutationRequestError(
      request({ origin: "https://panel.restoranyonetim.com", fetchSite: "cross-site" }),
      [],
    ) ?? "",
    /Çapraz site/,
  );
});

test("an explicitly configured operational origin can be allowed", () => {
  assert.equal(
    mutationRequestError(request({ origin: "https://admin.internal.example" }), [
      "https://admin.internal.example/ignored-path",
    ]),
    null,
  );
});
