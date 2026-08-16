#!/usr/bin/env node

import { createRequire } from 'node:module';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { auditArtifact } from './audit-artifact.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '../..');
const FORBIDDEN_COMPONENT = /^(?:\.git|\.bin|test|tests|__tests__|coverage|fixtures?|docs?)$/i;
const FORBIDDEN_EXTENSION = /\.(?:ts|tsx|map|md|markdown)$/i;
const PRIVATE_KEY = /-----BEGIN (?:EC |RSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/;
const SOURCE_MAP_MARKER = /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=.*?(?:\*\/)?\s*$/gm;

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--deploy-root', '--stage-root'].includes(key) || !value || value.startsWith('--')) {
      throw new Error('Kullanim: bundle-api-npm-runtime --deploy-root <pnpm-deploy> --stage-root <build/stage/local>');
    }
    result[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = path.resolve(value);
  }
  if (!result.deployRoot || !result.stageRoot) throw new Error('deploy-root ve stage-root zorunludur.');
  return result;
}

function assertInside(candidate, root, label) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} guvenli kokun disinda: ${candidate}`);
  }
  return relative;
}

/// Gercek paket koku, `node_modules` altinda paket adiyla biten dizindir.
/// Bazi paketler alt klasorlerine de ayni `name` alanini tasiyan bir
/// package.json koyar (engine.io-parser build/cjs icine
/// {"name":"engine.io-parser","type":"commonjs"} koyar). Ada bakip duran bir
/// arama bu alt klasoru kok sanir ve paketin asil package.json'i kopyalanmaz;
/// Node da modulu cozemez.
function isPackageRootDirectory(directory, expectedName) {
  const expected = expectedName.split('/');
  const parts = directory.split(path.sep).filter(Boolean);
  if (parts.length <= expected.length) return false;
  const tail = parts.slice(-expected.length);
  if (tail.join('/') !== expected.join('/')) return false;
  return parts[parts.length - expected.length - 1] === 'node_modules';
}

async function packageRootFromEntry(entry, expectedName) {
  let current = path.dirname(await realpath(entry));
  let fallback = null;
  while (true) {
    const packagePath = path.join(current, 'package.json');
    try {
      const parsed = JSON.parse(await readFile(packagePath, 'utf8'));
      if (parsed.name === expectedName) {
        if (isPackageRootDirectory(current, expectedName)) {
          return { root: current, manifest: parsed };
        }
        // node_modules disinda cozumlenen paketler (workspace linkleri) icin
        // ada gore eslesen en ustteki adayi yedekte tutuyoruz.
        fallback = { root: current, manifest: parsed };
      }
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) {
      if (fallback) return fallback;
      throw new Error(`Paket koku bulunamadi: ${expectedName}`);
    }
    current = parent;
  }
}

async function resolvePackage(name, fromPackageJson) {
  const resolver = createRequire(fromPackageJson);
  let entry;
  try {
    entry = resolver.resolve(name);
  } catch {
    try { entry = resolver.resolve(`${name}/package.json`); }
    catch { throw new Error(`Runtime paketi cozumlenemedi: ${name}`); }
  }
  return packageRootFromEntry(entry, name);
}

async function copyPackageTree(sourceRoot, destinationRoot) {
  async function visit(relativeDirectory = '') {
    const sourceDirectory = path.join(sourceRoot, relativeDirectory);
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      if (FORBIDDEN_COMPONENT.test(entry.name) || entry.name === 'node_modules') continue;
      const relative = path.join(relativeDirectory, entry.name);
      const source = path.join(sourceRoot, relative);
      const state = await lstat(source);
      if (state.isSymbolicLink()) {
        throw new Error(`Runtime paketinde symlink reddedildi: ${source}`);
      }
      if (state.isDirectory()) {
        await visit(relative);
        continue;
      }
      if (!state.isFile() || FORBIDDEN_EXTENSION.test(entry.name)) continue;
      let bytes = await readFile(source);
      if (!bytes.includes(0)) {
        let text = bytes.toString('utf8');
        if (PRIVATE_KEY.test(text)) throw new Error(`Private key runtime paketine giremez: ${source}`);
        text = text.replace(SOURCE_MAP_MARKER, '');
        bytes = Buffer.from(text, 'utf8');
      }
      const destination = path.join(destinationRoot, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { flag: 'wx' });
    }
  }
  await visit();
}

async function copyPrismaAssets(stageRoot) {
  const sourceRoot = path.join(REPOSITORY_ROOT, 'apps/api/prisma');
  const targetRoot = path.join(stageRoot, 'api/prisma');
  for (const relative of ['schema.prisma', 'migrations']) {
    const source = path.join(sourceRoot, relative);
    const state = await lstat(source);
    if (state.isFile()) {
      await mkdir(targetRoot, { recursive: true });
      await writeFile(path.join(targetRoot, relative), await readFile(source), { flag: 'wx' });
    } else {
      await copyPackageTree(source, path.join(targetRoot, relative));
    }
  }
}

async function countFiles(root) {
  let count = 0;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile()) count += 1;
      else throw new Error(`Stage icinde indirect dosya reddedildi: ${candidate}`);
    }
  }
  await visit(root);
  return count;
}

export async function bundleApiNpmRuntime({ deployRoot, stageRoot }) {
  const deployModules = await realpath(path.join(deployRoot, 'node_modules'));
  const stage = await realpath(stageRoot);
  const manifestPath = path.join(stage, 'manifest.json');
  const metadataPath = path.join(stage, 'metadata/dependencies.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  if (manifest.profile !== 'local' || manifest.npmDependenciesBundled !== false) {
    throw new Error('Bundler yalniz henuz bundle edilmemis local stage kabul eder.');
  }
  const requestedPackages = [...new Set([...(metadata.npmExternals ?? []), 'prisma'])];
  const visited = new Set();
  const deployPackageJson = path.join(deployRoot, 'package.json');
  const queue = [];
  for (const request of requestedPackages) {
    queue.push(await resolvePackage(request, deployPackageJson));
  }
  while (queue.length > 0) {
    const resolved = queue.shift();
    const canonicalRoot = await realpath(resolved.root);
    const relativeRoot = assertInside(
      canonicalRoot,
      deployModules,
      `Runtime paketi ${resolved.manifest.name}`,
    );
    const identity = `${resolved.manifest.name}@${resolved.manifest.version}:${relativeRoot}`;
    if (visited.has(identity)) continue;
    visited.add(identity);
    if (resolved.manifest.name.startsWith('@rest-otm/')) continue;
    const destination = path.join(stage, 'api/node_modules', relativeRoot);
    await copyPackageTree(canonicalRoot, destination);
    const dependencies = {
      ...(resolved.manifest.dependencies ?? {}),
      ...(resolved.manifest.optionalDependencies ?? {}),
    };
    const packageJson = path.join(canonicalRoot, 'package.json');
    for (const dependency of Object.keys(dependencies)) {
      const child = await resolvePackage(dependency, packageJson);
      const childRoot = await realpath(child.root);
      const childRelative = assertInside(childRoot, deployModules, `Transitif paket ${dependency}`);
      const childIdentity = `${child.manifest.name}@${child.manifest.version}:${childRelative}`;
      if (!visited.has(childIdentity)) queue.push(child);
    }
  }

  const prismaGenerated = path.join(deployModules, '.prisma');
  if ((await lstat(prismaGenerated).catch(() => null))?.isDirectory()) {
    await copyPackageTree(prismaGenerated, path.join(stage, 'api/node_modules/.prisma'));
  } else {
    throw new Error('Prisma generated runtime deploy icinde bulunamadi.');
  }
  await copyPrismaAssets(stage);
  manifest.npmDependenciesBundled = true;
  manifest.files = await countFiles(stage);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8' });
  const audit = await auditArtifact({ profile: 'local', root: stage });
  if (!audit.ok) {
    const summary = audit.findings.slice(0, 10).map((finding) => `${finding.code}:${finding.path}`).join(', ');
    throw new Error(`Bundle edilmis local stage audit basarisiz: ${summary}`);
  }
  return { packages: visited.size, files: manifest.files };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await bundleApiNpmRuntime(options);
  console.log(`[api-runtime-bundle] ${result.packages} paket, ${result.files} dosya`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main().catch((error) => {
  console.error(`[api-runtime-bundle] HATA: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
