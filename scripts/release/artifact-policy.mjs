import path from 'node:path';

const COMMON_TOP_LEVEL = Object.freeze([
  'api',
  'assets',
  'config',
  'database',
  'metadata',
  'migrations',
  'runtime',
]);

export const PROFILES = Object.freeze({
  local: Object.freeze({
    allowedTopLevel: Object.freeze([
      ...COMMON_TOP_LEVEL,
      'admin',
      'print-agent',
      'waiter',
    ]),
    allowedRootFiles: Object.freeze([
      'checksums.json',
      'license.txt',
      'manifest.json',
      'readme.txt',
      'version.json',
    ]),
    requiredEntryPoint: /(?:^|\/)api\/local\.js$/i,
    forbiddenPaths: Object.freeze([
      /(?:^|\/)api\/cloud\.js$/i,
      /(?:^|\/)modules\/license-admin(?:\/|$)/i,
      /(?:^|\/)modules\/license(?:\/|$)/i,
      /(?:^|\/)modules\/public\/public-cloud\.controller\.js$/i,
      /(?:^|\/)license\/sign\.js$/i,
      /(?:^|\/)sign(?:er|ing)?\.js$/i,
      /(?:^|\/)(?:private|signer|signing)[^/]*\.(?:jks|key|p12|pem|pfx)$/i,
      /(?:^|\/)[^/]+\.(?:jks|p12|pfx)$/i,
    ]),
    forbiddenText: Object.freeze([
      /@rest-otm\/license\/sign/i,
      /packages\/license\/(?:src|dist)\/sign(?:\.[A-Za-z0-9]+)?/i,
      /(?:^|[^A-Z0-9_])LICENSE_PRIVATE_KEY(?:[^A-Z0-9_]|$)/,
      /(?:^|[^A-Za-z0-9_])issueLicense\s*\(/,
      /modules\/license-admin/i,
      /modules\/license\/(?:license\.)?(?:routes|controller|service)/i,
      /public-cloud\.controller/i,
    ]),
  }),
  cloud: Object.freeze({
    allowedTopLevel: Object.freeze([
      ...COMMON_TOP_LEVEL,
      'menu',
      'superadmin',
    ]),
    allowedRootFiles: Object.freeze([
      'checksums.json',
      'license.txt',
      'manifest.json',
      'readme.txt',
      'version.json',
    ]),
    requiredEntryPoint: /(?:^|\/)api\/cloud\.js$/i,
    forbiddenPaths: Object.freeze([
      /(?:^|\/)api\/local\.js$/i,
      /(?:^|\/)modules\/(?:cms|customers|inventory|invoice|local-license|menu|orders|pos|printing|reports|reservations|staff|tables|waiter)(?:\/|$)/i,
      /(?:^|\/)modules\/public\/(?:local-public\.routes|local-waiter-call\.controller)\.js$/i,
      /(?:^|\/)print-agent(?:\/|$)/i,
      /(?:^|\/)receipt-core(?:\/|$)/i,
      /(?:^|\/)websocket(?:\/|$)/i,
      /(?:^|\/)utils\/(?:department-routing|print-triggers)\.js$/i,
    ]),
    forbiddenText: Object.freeze([
      /modules\/(?:cms|customers|inventory|invoice|local-license|menu|orders|pos|printing|reports|reservations|staff|tables|waiter)(?:\/|['"])/i,
      /@rest-otm\/receipt-core/i,
      /(?:^|[^A-Z0-9_])PRINT_AGENT_(?:PORT|SECRET)(?:[^A-Z0-9_]|$)/,
      /(?:^|[^A-Z0-9_])LOCAL_LICENSE_(?:DATA_DIR|SERVER_URL|PUBLIC_KEY|HEARTBEAT_MS|RETRY_MS)(?:[^A-Z0-9_]|$)/,
      /(?:initializeSocketServer|initCleanupTask)\s*\(/,
      /(?:local-public\.routes|local-waiter-call|waiter:called)/i,
    ]),
  }),
});

export const UNIVERSAL_FORBIDDEN_PATHS = Object.freeze([
  /(?:^|\/)\.git(?:\/|$)/i,
  /(?:^|\/)\.env(?:\.[^/]*)?$/i,
  /(?:^|\/)(?:__tests__|tests?|fixtures?|coverage)(?:\/|$)/i,
  /(?:^|\/)[^/]+\.(?:ts|tsx|map)$/i,
]);

export const UNIVERSAL_FORBIDDEN_TEXT = Object.freeze([
  /\/\/[#@]\s*sourceMappingURL\s*=/,
  /\/\*[#@]\s*sourceMappingURL\s*=/,
  /-----BEGIN (?:EC |RSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
]);

export function normalizeArtifactPath(value) {
  return value.split(path.sep).join('/').replace(/^\.\//, '');
}

export function isTopLevelAllowed(relativePath, policy) {
  const normalized = normalizeArtifactPath(relativePath);
  const [topLevel] = normalized.split('/');
  if (!topLevel) return false;

  if (!normalized.includes('/')) {
    return policy.allowedRootFiles.includes(topLevel.toLowerCase());
  }

  return policy.allowedTopLevel.includes(topLevel.toLowerCase());
}
