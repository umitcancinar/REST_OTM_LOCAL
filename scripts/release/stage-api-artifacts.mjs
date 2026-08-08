#!/usr/bin/env node

import { builtinModules } from 'node:module';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { auditArtifact } from './audit-artifact.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '../..');
const BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const STATIC_REQUIRE = /\brequire\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/g;

const WORKSPACE_PACKAGES = Object.freeze({
  '@rest-otm/license': {
    root: path.join(REPOSITORY_ROOT, 'packages/license'),
    entries: { '.': 'dist/index.js', './sign': 'dist/sign.js' },
  },
  '@rest-otm/receipt-core': {
    root: path.join(REPOSITORY_ROOT, 'packages/receipt-core'),
    entries: { '.': 'dist/index.js' },
  },
});

function usage() {
  return 'Kullanim: node scripts/release/stage-api-artifacts.mjs [--profile local|cloud|all] [--dist apps/api/dist] [--out build/stage]';
}

export function parseStageArguments(argv) {
  const result = {
    profile: 'all',
    dist: path.join(REPOSITORY_ROOT, 'apps/api/dist'),
    out: path.join(REPOSITORY_ROOT, 'build/stage'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--profile', '--dist', '--out'].includes(key)) {
      throw new Error(`Bilinmeyen arguman: ${key}\n${usage()}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} icin deger gerekli.`);
    result[key.slice(2)] = value;
    index += 1;
  }
  if (!['local', 'cloud', 'all'].includes(result.profile)) {
    throw new Error('--profile local, cloud veya all olmali.');
  }
  result.dist = path.resolve(result.dist);
  result.out = path.resolve(result.out);
  return result;
}

function packageParts(specifier) {
  if (!specifier.startsWith('@')) return { packageName: specifier.split('/')[0], subpath: '.' };
  const [scope, name, ...rest] = specifier.split('/');
  return {
    packageName: `${scope}/${name}`,
    subpath: rest.length === 0 ? '.' : `./${rest.join('/')}`,
  };
}

async function existingModule(candidate) {
  const candidates = /\.(?:js|json|node)$/i.test(candidate)
    ? [candidate]
    : [candidate, `${candidate}.js`, `${candidate}.json`, path.join(candidate, 'index.js')];
  for (const filePath of candidates) {
    try {
      if ((await stat(filePath)).isFile()) return filePath;
    } catch {
      // Try the next Node CommonJS resolution shape.
    }
  }
  return null;
}

function assertInside(candidate, root, label) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} izin verilen kokun disina cikiyor: ${candidate}`);
  }
}

function safeProfileRoot(outputBase, profile) {
  const profileRoot = path.resolve(outputBase, profile);
  const filesystemRoot = path.parse(profileRoot).root;
  if (
    profileRoot === filesystemRoot ||
    path.dirname(profileRoot) === filesystemRoot ||
    path.basename(profileRoot) !== profile
  ) {
    throw new Error(`Guvenli olmayan staging hedefi: ${profileRoot}`);
  }
  return profileRoot;
}

function findStaticDependencies(source, sourcePath) {
  const dependencies = [];
  let match;
  let stripped = source;
  while ((match = STATIC_REQUIRE.exec(source)) !== null) {
    dependencies.push(match[2]);
    stripped = stripped.replace(match[0], '');
  }
  STATIC_REQUIRE.lastIndex = 0;
  if (/\brequire\s*\(/.test(stripped)) {
    throw new Error(`Dinamik require release closure icinde desteklenmiyor: ${sourcePath}`);
  }
  return dependencies;
}

export async function stageApiProfile({ profile, dist, out }) {
  if (profile !== 'local' && profile !== 'cloud') throw new Error(`Gecersiz profil: ${profile}`);
  const distRoot = path.resolve(dist);
  const outputBase = path.resolve(out);
  const profileRoot = safeProfileRoot(outputBase, profile);
  await access(path.join(distRoot, `${profile}.js`));
  await mkdir(outputBase, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(outputBase, `${profile}.tmp-`));

  const copied = new Set();
  const npmExternals = new Set();
  const nodeBuiltins = new Set();
  const workspaceDependencies = new Set();
  const dependencyGraph = {};

  async function copyModule(sourcePath, destinationPath, sourceBoundary) {
    const absoluteSource = path.resolve(sourcePath);
    assertInside(absoluteSource, sourceBoundary, 'Module');
    const normalizedDestination = destinationPath.split(path.sep).join('/');
    if (copied.has(normalizedDestination)) return;
    copied.add(normalizedDestination);

    const source = await readFile(absoluteSource, 'utf8');
    const dependencies = path.extname(absoluteSource) === '.js'
      ? findStaticDependencies(source, absoluteSource)
      : [];
    dependencyGraph[normalizedDestination] = [...dependencies].sort();

    const absoluteDestination = path.join(temporaryRoot, normalizedDestination);
    await mkdir(path.dirname(absoluteDestination), { recursive: true });
    await copyFile(absoluteSource, absoluteDestination);

    for (const specifier of dependencies) {
      if (specifier.startsWith('.')) {
        const resolved = await existingModule(path.resolve(path.dirname(absoluteSource), specifier));
        if (!resolved) throw new Error(`Cozulemeyen relative dependency: ${absoluteSource} -> ${specifier}`);
        assertInside(resolved, sourceBoundary, 'Relative dependency');
        const relativeToBoundary = path.relative(sourceBoundary, resolved);
        const destinationBoundary = normalizedDestination.slice(
          0,
          normalizedDestination.length - path.relative(sourceBoundary, absoluteSource).split(path.sep).join('/').length,
        );
        await copyModule(
          resolved,
          path.posix.join(destinationBoundary, relativeToBoundary.split(path.sep).join('/')),
          sourceBoundary,
        );
        continue;
      }

      if (BUILTINS.has(specifier)) {
        nodeBuiltins.add(specifier);
        continue;
      }

      const { packageName, subpath } = packageParts(specifier);
      const workspacePackage = WORKSPACE_PACKAGES[packageName];
      if (!workspacePackage) {
        npmExternals.add(packageName);
        continue;
      }

      const entry = workspacePackage.entries[subpath];
      if (!entry) throw new Error(`Workspace export allowlist disinda: ${specifier}`);
      workspaceDependencies.add(specifier);
      const packageDestination = path.posix.join('api/node_modules', packageName);
      const packageJsonDestination = path.posix.join(packageDestination, 'package.json');
      if (!copied.has(packageJsonDestination)) {
        copied.add(packageJsonDestination);
        await mkdir(path.join(temporaryRoot, packageDestination), { recursive: true });
        await copyFile(
          path.join(workspacePackage.root, 'package.json'),
          path.join(temporaryRoot, packageJsonDestination),
        );
      }
      await copyModule(
        path.join(workspacePackage.root, entry),
        path.posix.join(packageDestination, entry),
        workspacePackage.root,
      );
    }
  }

  try {
    await copyModule(
      path.join(distRoot, `${profile}.js`),
      `api/${profile}.js`,
      distRoot,
    );

    await mkdir(path.join(temporaryRoot, 'metadata'), { recursive: true });
    await writeFile(
      path.join(temporaryRoot, 'metadata/dependencies.json'),
      `${JSON.stringify({
        npmExternals: [...npmExternals].sort(),
        nodeBuiltins: [...nodeBuiltins].sort(),
        workspaceDependencies: [...workspaceDependencies].sort(),
      }, null, 2)}\n`,
    );
    await writeFile(
      path.join(temporaryRoot, 'metadata/dependency-graph.json'),
      `${JSON.stringify(dependencyGraph, null, 2)}\n`,
    );
    await writeFile(
      path.join(temporaryRoot, 'manifest.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        profile,
        entryPoint: `api/${profile}.js`,
        files: copied.size,
        npmDependenciesBundled: false,
        workspaceDependenciesPruned: true,
      }, null, 2)}\n`,
    );

    const audit = await auditArtifact({ profile, root: temporaryRoot });
    if (!audit.ok) {
      const summary = audit.findings
        .slice(0, 20)
        .map((finding) => `${finding.code}: ${finding.path}`)
        .join('\n');
      throw new Error(`Staging release audit'ten gecemedi:\n${summary}`);
    }

    await rm(profileRoot, { recursive: true, force: true });
    await rename(temporaryRoot, profileRoot);
    return { profile, root: profileRoot, files: copied.size, audit };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  try {
    const options = parseStageArguments(process.argv.slice(2));
    const profiles = options.profile === 'all' ? ['cloud', 'local'] : [options.profile];
    for (const profile of profiles) {
      const result = await stageApiProfile({ ...options, profile });
      console.log(`[release-stage] ${profile}: ${result.files} dosya -> ${result.root}`);
    }
  } catch (error) {
    console.error(`[release-stage] HATA: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) await main();
