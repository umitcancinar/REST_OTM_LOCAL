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

  assert.match(apiClient, /\/public\/menu\/\$\{slug\}/);
  assert.match(apiClient, /return data\.data/);
  assert.match(menuPage, /menuData=\{menuData\.categories\}/);
  assert.match(menuPage, /restaurantInfo=\{\{ name: menuData\.restaurantName \}\}/);
  assert.match(publicRoutes, /router\.get\(['"]\/menu\/\:slug['"],\s*publicController\.getMenuBySlug\)/);
  assert.match(publicController, /getMenuBySlug:[\s\S]*?data:\s*publication\.payload\.menu/);
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
