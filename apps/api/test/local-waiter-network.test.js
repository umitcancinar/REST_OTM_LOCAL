const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

test('garson telefonu taranmaz; baglanti IPsi guvenilir yerel gateway uzerinden otomatik kaydedilir', () => {
  const gateway = source('../../gateway/src/gateway.ts');
  const runtime = source('../src/runtime/base.runtime.ts');
  const controller = source('../src/modules/auth/auth.controller.ts');
  const service = source('../src/modules/auth/auth.service.ts');
  const waiter = source('../../waiter/src/app/page.tsx');

  assert.match(gateway, /lower\.startsWith\('x-forwarded-'\)/);
  assert.match(gateway, /headers\['x-forwarded-for'\] = remoteAddress/);
  assert.match(gateway, /headers\['x-restotm-gateway'\] = '1'/);
  assert.match(runtime, /ip === '127\.0\.0\.1'/);
  assert.match(runtime, /ip === '::ffff:127\.0\.0\.1'/);
  assert.match(controller, /ip: req\.ip/);
  assert.match(service, /ip: context\?\.ip \?\? null/);
  assert.match(waiter, /aynı Wi-Fi ağına bağlayın/);
  assert.match(waiter, /NEXT_PUBLIC_API_URL \|\| '\/api'/);
  assert.doesNotMatch(waiter, /navigator\.connection|RTCPeerConnection|WebRTC|arp|Get-NetNeighbor/i);
});
