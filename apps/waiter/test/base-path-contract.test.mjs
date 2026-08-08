import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const waiterRoot = path.resolve(testDir, '..');
const read = (relativePath) => fs.readFileSync(path.join(waiterRoot, relativePath), 'utf8');

test('garson LAN uygulamasinin giris, oturum ve PWA yollari /garson altinda kalir', () => {
  const nextConfig = read('next.config.ts');
  const apiClient = read('src/lib/api.ts');
  const rootLayout = read('src/app/layout.tsx');
  const manifest = JSON.parse(read('public/manifest.json'));

  assert.match(nextConfig, /basePath:\s*['"]\/garson['"]/);
  assert.match(apiClient, /WAITER_BASE_PATH\s*=\s*['"]\/garson['"]/);
  assert.match(apiClient, /window\.location\.href\s*=\s*`\$\{WAITER_BASE_PATH\}\/\?error=session_expired`/);
  assert.match(rootLayout, /manifest:\s*['"]\/garson\/manifest\.json['"]/);
  assert.match(rootLayout, /href=['"]\/garson\/icon\.png['"]/);
  assert.equal(manifest.scope, '/garson/');
  assert.equal(manifest.start_url, '/garson/');
  assert.ok(manifest.icons.every((icon) => icon.src.startsWith('/garson/')));
  assert.ok(manifest.icons.every((icon) => fs.existsSync(path.join(waiterRoot, 'src/app', path.basename(icon.src)))));
});
