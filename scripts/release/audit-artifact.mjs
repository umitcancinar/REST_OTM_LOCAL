#!/usr/bin/env node

import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  isTopLevelAllowed,
  normalizeArtifactPath,
  PROFILES,
  UNIVERSAL_FORBIDDEN_PATHS,
  UNIVERSAL_FORBIDDEN_TEXT,
} from './artifact-policy.mjs';

const TEXT_SCAN_CHUNK_BYTES = 64 * 1024;
const TEXT_SCAN_OVERLAP_CHARS = 1024;

function usage() {
  return 'Kullanim: node scripts/release/audit-artifact.mjs --profile <local|cloud> --root <staging-dizini> [--json]';
}

export function parseArguments(argv) {
  const parsed = { json: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg !== '--profile' && arg !== '--root') {
      throw new Error(`Bilinmeyen arguman: ${arg}\n${usage()}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${arg} icin deger gerekli.\n${usage()}`);
    }
    parsed[arg.slice(2)] = value;
    index += 1;
  }

  if (!parsed.profile || !PROFILES[parsed.profile]) {
    throw new Error(`--profile local veya cloud olmali.\n${usage()}`);
  }
  if (!parsed.root) throw new Error(`--root gerekli.\n${usage()}`);
  return parsed;
}

async function findForbiddenText(filePath, size, patterns) {
  if (size === 0 || patterns.length === 0) return null;
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(TEXT_SCAN_CHUNK_BYTES);
    let offset = 0;
    let overlap = '';

    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (bytesRead === 0) break;
      const bytes = buffer.subarray(0, bytesRead);
      // Native executables and other binary payloads remain path-audited. A
      // NUL-bearing chunk is not decoded, but later chunks are still visited.
      if (!bytes.includes(0)) {
        const content = overlap + bytes.toString('utf8');
        const matched = patterns.find((pattern) => pattern.test(content));
        if (matched) return matched;
        overlap = content.slice(-TEXT_SCAN_OVERLAP_CHARS);
      } else {
        overlap = '';
      }
      offset += bytesRead;
    }
    return null;
  } finally {
    await handle.close();
  }
}

async function collectFiles(rootPath, relativeDirectory = '') {
  const absoluteDirectory = path.join(rootPath, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = normalizeArtifactPath(path.join(relativeDirectory, entry.name));
    const absolutePath = path.join(rootPath, relativePath);
    const stats = await lstat(absolutePath);

    if (stats.isSymbolicLink()) {
      files.push({ relativePath, absolutePath, stats, kind: 'symlink' });
      continue;
    }
    if (stats.isDirectory()) {
      files.push(...await collectFiles(rootPath, relativePath));
      continue;
    }
    if (stats.isFile()) files.push({ relativePath, absolutePath, stats, kind: 'file' });
    else files.push({ relativePath, absolutePath, stats, kind: 'special' });
  }

  return files;
}

function addFinding(findings, code, relativePath, detail) {
  findings.push({ code, path: relativePath, detail });
}

export async function auditArtifact({ profile, root }) {
  const policy = PROFILES[profile];
  if (!policy) throw new Error(`Bilinmeyen profil: ${profile}`);

  const rootPath = path.resolve(root);
  const rootStats = await lstat(rootPath);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`Artifact root gercek bir dizin olmali: ${rootPath}`);
  }

  const canonicalRoot = await realpath(rootPath);
  const files = await collectFiles(canonicalRoot);
  const findings = [];
  let hasRequiredEntryPoint = false;

  // Empty unknown directories would otherwise be invisible to a file-only
  // walk. The staging root itself is a strict contract, including directories.
  const rootEntries = await readdir(canonicalRoot, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isDirectory() && !policy.allowedTopLevel.includes(entry.name.toLowerCase())) {
      addFinding(findings, 'not-allowlisted', entry.name, `${profile} artifact kok allowlist disinda`);
    }
  }

  for (const file of files) {
    const relativePath = file.relativePath;

    if (file.kind === 'file' && policy.requiredEntryPoint.test(relativePath)) {
      hasRequiredEntryPoint = true;
    }

    if (!isTopLevelAllowed(relativePath, policy)) {
      addFinding(findings, 'not-allowlisted', relativePath, `${profile} artifact kok allowlist disinda`);
    }
    if (file.kind !== 'file') {
      addFinding(findings, 'unsafe-file-type', relativePath, `Artifact icinde ${file.kind} kabul edilmez`);
      continue;
    }

    for (const pattern of UNIVERSAL_FORBIDDEN_PATHS) {
      if (pattern.test(relativePath)) {
        addFinding(findings, 'forbidden-common-path', relativePath, pattern.toString());
        break;
      }
    }
    for (const pattern of policy.forbiddenPaths) {
      if (pattern.test(relativePath)) {
        addFinding(findings, `forbidden-${profile}-path`, relativePath, pattern.toString());
        break;
      }
    }

    const commonTextMatch = await findForbiddenText(
      file.absolutePath,
      file.stats.size,
      UNIVERSAL_FORBIDDEN_TEXT,
    );
    if (commonTextMatch) {
      addFinding(findings, 'forbidden-common-content', relativePath, commonTextMatch.toString());
    }

    const profileTextMatch = await findForbiddenText(
      file.absolutePath,
      file.stats.size,
      policy.forbiddenText,
    );
    if (profileTextMatch) {
      addFinding(findings, `forbidden-${profile}-content`, relativePath, profileTextMatch.toString());
    }
  }

  if (!hasRequiredEntryPoint) {
    addFinding(
      findings,
      'missing-entry-point',
      profile === 'local' ? 'api/local.js' : 'api/cloud.js',
      `${profile} artifact giris noktasi bulunamadi`,
    );
  }

  findings.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
  return {
    ok: findings.length === 0,
    profile,
    root: canonicalRoot,
    filesScanned: files.length,
    findings,
  };
}

function printHuman(result) {
  const status = result.ok ? 'GECTI' : 'KALDI';
  console.log(`[release-audit] ${status}: ${result.profile} (${result.filesScanned} dosya)`);
  for (const finding of result.findings) {
    console.error(`- ${finding.code}: ${finding.path} (${finding.detail})`);
  }
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await auditArtifact(options);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else printHuman(result);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`[release-audit] HATA: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) await main();
