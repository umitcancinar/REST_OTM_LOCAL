import { isIP } from 'node:net';

export type GatewayTargetName = 'api' | 'admin' | 'waiter';

export interface GatewayTarget {
  name: GatewayTargetName;
  hostname: string;
  port: number;
}

export interface GatewayConfig {
  bindHost: string;
  port: number;
  targets: Record<GatewayTargetName, GatewayTarget>;
  allowedHosts: ReadonlySet<string>;
  allowPrivateIpHosts: boolean;
  upstreamTimeoutMs: number;
  maxContentLengthBytes: number;
}

function integer(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} gecersiz.`);
  }
  return value;
}

function parseTarget(name: GatewayTargetName, raw: string | undefined, fallbackPort: number): GatewayTarget {
  let parsed: URL;
  try {
    parsed = new URL(raw || `http://127.0.0.1:${fallbackPort}`);
  } catch {
    throw new Error(`${name} upstream adresi gecersiz.`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    parsed.protocol !== 'http:'
    || (hostname !== '127.0.0.1' && hostname !== '::1' && hostname !== 'localhost')
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`${name} upstream yalniz kimlik bilgisiz loopback HTTP kok adresi olabilir.`);
  }

  return {
    name,
    hostname,
    port: integer(`${name} upstream portu`, parsed.port, fallbackPort, 1, 65535),
  };
}

function normalizeAllowedHost(value: string): string {
  const host = value.trim().toLowerCase();
  if (!host || host === '*' || /[\s/\\?#@]/.test(host)) {
    throw new Error('GATEWAY_ALLOWED_HOSTS gecersiz bir deger iceriyor.');
  }
  return host.replace(/^\[|\]$/g, '');
}

export function isPrivateIpHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const family = isIP(normalized);
  if (family === 4) {
    const octets = normalized.split('.').map(Number);
    const first = octets[0] ?? -1;
    const second = octets[1] ?? -1;
    return first === 10
      || first === 127
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 169 && second === 254);
  }
  if (family === 6) {
    return normalized === '::1'
      || normalized.startsWith('fe8')
      || normalized.startsWith('fe9')
      || normalized.startsWith('fea')
      || normalized.startsWith('feb')
      || normalized.startsWith('fc')
      || normalized.startsWith('fd');
  }
  return false;
}

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const isProduction = env.NODE_ENV === 'production';
  const configuredHosts = (env.GATEWAY_ALLOWED_HOSTS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeAllowedHost);

  if (isProduction && configuredHosts.length === 0) {
    throw new Error('Production gateway icin GATEWAY_ALLOWED_HOSTS zorunludur.');
  }

  const allowedHosts = new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    ...configuredHosts,
  ]);

  return {
    bindHost: env.GATEWAY_BIND_HOST || (isProduction ? '0.0.0.0' : '127.0.0.1'),
    port: integer('GATEWAY_PORT', env.GATEWAY_PORT, 8787, 1, 65535),
    targets: {
      api: parseTarget('api', env.GATEWAY_API_TARGET, 4100),
      admin: parseTarget('admin', env.GATEWAY_ADMIN_TARGET, 3100),
      waiter: parseTarget('waiter', env.GATEWAY_WAITER_TARGET, 3200),
    },
    allowedHosts,
    allowPrivateIpHosts: env.GATEWAY_ALLOW_PRIVATE_IP_HOSTS !== 'false',
    upstreamTimeoutMs: integer('GATEWAY_UPSTREAM_TIMEOUT_MS', env.GATEWAY_UPSTREAM_TIMEOUT_MS, 30_000, 1_000, 300_000),
    maxContentLengthBytes: integer('GATEWAY_MAX_CONTENT_LENGTH_BYTES', env.GATEWAY_MAX_CONTENT_LENGTH_BYTES, 10 * 1024 * 1024, 1024, 100 * 1024 * 1024),
  };
}
