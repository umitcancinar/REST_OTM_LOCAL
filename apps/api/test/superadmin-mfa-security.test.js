const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
}

const service = source('src', 'modules', 'auth', 'superadmin-mfa.service.ts');
const authService = source('src', 'modules', 'auth', 'auth.service.ts');
const routes = source('src', 'modules', 'auth', 'superadmin-mfa.routes.ts');
const cloudProfile = source('src', 'runtime', 'cloud.profile.ts');
const localProfile = source('src', 'runtime', 'local.profile.ts');
const limiter = source('src', 'middlewares', 'rateLimiter.middleware.ts');
const serviceAuth = source('src', 'middlewares', 'superadmin-service-auth.middleware.ts');
const schema = source('prisma', 'schema.prisma');
const migration = source('prisma', 'migrations', '20260810010000_add_superadmin_mfa_challenges', 'migration.sql');
const superadminSession = fs.readFileSync(path.join(__dirname, '..', '..', 'superadmin', 'src', 'lib', 'server-session.ts'), 'utf8');
const superadminLogin = fs.readFileSync(path.join(__dirname, '..', '..', 'superadmin', 'src', 'app', 'api', 'auth', 'login', 'route.ts'), 'utf8');
const superadminVerify = fs.readFileSync(path.join(__dirname, '..', '..', 'superadmin', 'src', 'app', 'api', 'auth', 'verify-email', 'route.ts'), 'utf8');

test('MFA challenge is durable and only one active challenge can exist per user', () => {
  assert.match(migration, /CREATE TABLE "superadmin_mfa_challenges"/);
  assert.match(migration, /CREATE UNIQUE INDEX "superadmin_mfa_one_active_per_user"/);
  assert.match(migration, /WHERE "consumedAt" IS NULL AND "invalidatedAt" IS NULL/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
  assert.match(service, /recentStarts[\s\S]*MAX_STARTS_PER_WINDOW/);
});

test('verification consumes the challenge and issues tokens in the same transaction', () => {
  assert.match(service, /superAdminMfaChallenge\.updateMany\([\s\S]*data: \{ consumedAt: now \}/);
  assert.match(service, /if \(consumed\.count !== 1\)/);
  assert.match(service, /issueTokens\([\s\S]*context,[\s\S]*tx/);
  assert.match(service, /attempts: \{ increment: 1 \}/);
  assert.match(service, /codeHash: codeHash\(id, code\)/);
  const model = schema.match(/model SuperAdminMfaChallenge \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(model, /^\s*code\s+String/m);
});

test('browser pending cookie carries no code hash, attempts or bearer tokens', () => {
  assert.match(superadminSession, /type PendingMfa = \{ id: string; expiresAt: number \}/);
  assert.doesNotMatch(superadminSession, /type PendingMfa =[^\n]*(?:codeHash|accessToken|refreshToken|attempts)/);
  assert.doesNotMatch(superadminSession, /verifyMfa/);
  assert.match(superadminLogin, /auth\/superadmin\/mfa\/start/);
  assert.match(superadminVerify, /auth\/superadmin\/mfa\/verify/);
});

test('superadmin routes require service auth and avoid shared Render IP rate keys', () => {
  assert.match(routes, /mfa\/start', superAdminServiceAuth, superAdminMfaStartLimiter/);
  assert.match(routes, /mfa\/verify', superAdminServiceAuth, superAdminMfaVerifyLimiter/);
  assert.match(routes, /refresh', superAdminServiceAuth, superAdminSessionLimiter/);
  assert.match(cloudProfile, /api\/auth\/superadmin', superAdminMfaRoutes/);
  assert.doesNotMatch(localProfile, /superAdminMfaRoutes|api\/auth\/superadmin/);
  assert.match(serviceAuth, /timingSafeEqual/);
  assert.match(limiter, /req\.body\?\.email/);
  assert.match(limiter, /x-rest-otm-client-key/);
  assert.match(superadminLogin, /createHmac\("sha256", secret\)[\s\S]*x-rest-otm-client-key/);
  assert.match(limiter, /req\.body\?\.challengeId/);
  assert.doesNotMatch(limiter.match(/export const superAdminMfaStartLimiter[\s\S]*?\n\}\);/)[0], /req\.ip/);
});

test('public auth paths cannot mint or refresh a superadmin session', () => {
  assert.match(authService, /if \(user\.role === 'SUPER_ADMIN'\)[\s\S]*E-posta veya şifre hatalı/);
  assert.match(authService, /decoded\.role === 'SUPER_ADMIN' && !allowSuperAdmin/);
  assert.match(authService, /role: 'WAITER', isActive: true, pin/);
});
