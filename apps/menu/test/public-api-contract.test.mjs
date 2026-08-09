import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const menuRoot = path.resolve(testDir, '..');
const repositoryRoot = path.resolve(menuRoot, '../..');
const readMenu = (relativePath) => fs.readFileSync(path.join(menuRoot, relativePath), 'utf8');
const readRepository = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

test('mevcut slug menu ekrani cloud projection sonrasinda ayni veri seklini kullanir', () => {
  const apiClient = readMenu('src/lib/api.ts');
  const menuPage = readMenu('src/app/[slug]/page.tsx');
  const publicRoutes = readRepository('apps/api/src/modules/public/public.routes.ts');
  const publicController = readRepository('apps/api/src/modules/public/public-cloud.controller.ts');

  assert.match(apiClient, /\/public\/menu\/\$\{encodeURIComponent\(slug\)\}/);
  assert.match(apiClient, /return data\.data/);
  assert.match(menuPage, /menuData=\{menuData\.categories\}/);
  assert.match(menuPage, /restaurantInfo=\{\{ name: menuData\.restaurantName \}\}/);
  assert.match(publicRoutes, /router\.get\(['"]\/menu\/\:slug['"],\s*publicController\.getMenuBySlug\)/);
  assert.match(publicController, /getMenuBySlug:[\s\S]*?data:\s*publication\.payload\.menu/);
});

test('masa QR menusu LAN child olur; veri cloud HTTPS, aksiyon same-origin local kalir', () => {
  const apiClient = readMenu('src/lib/api.ts');
  const menuPage = readMenu('src/app/[slug]/page.tsx');
  const menuClient = readMenu('src/app/[slug]/MenuClient.tsx');
  const nextConfig = readMenu('next.config.ts');

  assert.match(nextConfig, /process\.env\.MENU_BASE_PATH \|\| ['"]['"]/);
  assert.match(nextConfig, /menuBasePath !== ['"]['"] && menuBasePath !== ['"]\/menu['"]/);
  assert.match(nextConfig, /basePath:\s*menuBasePath/);
  assert.match(apiClient, /CLOUD_MENU_API_URL/);
  assert.match(apiClient, /NODE_ENV === ['"]production['"][\s\S]*parsed\.protocol !== ['"]https:['"]/);
  assert.doesNotMatch(apiClient, /NEXT_PUBLIC_API_URL/);
  assert.match(menuPage, /searchParams[\s\S]*tableId[\s\S]*tableToken/);
  assert.match(menuClient, /fetch\(`\/api\/public\/waiter\/call\/\$\{encodeURIComponent\(tenantSlug\)\}`/);
  assert.match(menuClient, /JSON\.stringify\(\{ tableId, tableToken \}\)/);
  assert.doesNotMatch(menuClient, /NEXT_PUBLIC_API_URL/);
});

test('legacy cloud QR /slug routeu basePath olmadan korunur', () => {
  const nextConfig = readMenu('next.config.ts');
  const menuPage = readMenu('src/app/[slug]/page.tsx');
  assert.match(nextConfig, /process\.env\.MENU_BASE_PATH \|\| ['"]['"]/);
  assert.match(menuPage, /export default async function MenuPage/);
  assert.match(menuPage, /getRestaurantMenu\(slug\)/);
});

test('eski salt-okunur CMS slug endpointleri route seviyesinde korunur', () => {
  const publicRoutes = readRepository('apps/api/src/modules/public/public.routes.ts');
  for (const route of [
    'settings',
    'gallery',
    'stories',
    'reviews',
    'reservations',
    'tablemap',
    'navlinks',
  ]) {
    assert.match(publicRoutes, new RegExp(`\\/cms\\/${route}\\/\\:slug`));
  }
});
