import assert from "node:assert/strict";
import test from "node:test";
import { resolveMarketingOrigin } from "../src/lib/public-origin.ts";

test("production Render internal URL redirects to the public marketing domain", () => {
  assert.equal(
    resolveMarketingOrigin("http://localhost:10000/api/demo-request", { production: true }),
    "https://www.restoranyonetim.com",
  );
});

test("a valid configured HTTPS origin takes precedence", () => {
  assert.equal(
    resolveMarketingOrigin("http://localhost:10000/api/demo-request", {
      production: true,
      configuredOrigin: "https://restoranyonetim.com",
    }),
    "https://restoranyonetim.com",
  );
});

test("unsafe configured origins cannot create an open redirect", () => {
  assert.equal(
    resolveMarketingOrigin("http://localhost:10000/api/demo-request", {
      production: true,
      configuredOrigin: "https://evil.example/path",
    }),
    "https://www.restoranyonetim.com",
  );
});

test("development keeps the request origin", () => {
  assert.equal(
    resolveMarketingOrigin("http://localhost:3000/api/demo-request", { production: false }),
    "http://localhost:3000",
  );
});
