import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('login authorization probe uses a non-error session status endpoint', () => {
  const layout = source('../src/components/layout/LayoutWrapper.tsx');
  const route = source('../src/app/api/auth/session/route.ts');
  assert.match(layout, /fetch\('\/api\/auth\/session'/);
  assert.doesNotMatch(layout, /\/api\/backend\/auth\/profile/);
  assert.match(route, /'pending-mfa'/);
  assert.match(route, /'unauthenticated'/);
  assert.match(route, /'unavailable'/);
  assert.match(route, /profile\(active\)/);
});

test('critical settings cards are live and fail closed instead of hard-coded green', () => {
  const settings = source('../src/app/(dashboard)/settings/page.tsx');
  assert.match(settings, /fetch\('\/api\/backend\/ready'/);
  assert.match(settings, /fetch\('\/api\/auth\/session'/);
  assert.match(settings, /payload\.database === 'ready'/);
  assert.match(settings, /payload\.security\?\.mfaVerified === true/);
  assert.doesNotMatch(settings, />Etkin</);
  assert.match(settings, /state: 'failed'/);
});

test('Safari does not use the Cloudflare flexible iframe sizing path', () => {
  const turnstile = source('../src/components/auth/AdminTurnstile.tsx');
  assert.match(turnstile, /size: 'normal'/);
  assert.doesNotMatch(turnstile, /size: 'flexible'/);
});
