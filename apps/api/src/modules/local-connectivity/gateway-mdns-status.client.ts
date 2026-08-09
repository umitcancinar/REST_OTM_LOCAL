const GATEWAY_STATUS_URL = 'http://127.0.0.1:8787/__restotm/health';
const MAX_STATUS_BYTES = 4 * 1024;

export type GatewayMdnsState = 'disabled' | 'probing' | 'announced' | 'collision' | 'failed' | 'stopped' | 'unavailable';
export type GatewayMdnsReason = 'NO_LAN_ADDRESS' | 'HOSTNAME_COLLISION' | 'SOCKET_ERROR' | 'GATEWAY_STATUS_UNAVAILABLE' | null;

export interface GatewayMdnsView {
  state: GatewayMdnsState;
  advertised: boolean;
  hostname: string | null;
  serviceType: '_rest-otm._tcp.local';
  port: 8787;
  addresses: number;
  reason: GatewayMdnsReason;
}

export interface GatewayMdnsStatusProvider {
  getStatus(): Promise<GatewayMdnsView>;
}

type FetchLike = typeof fetch;

const FALLBACK: GatewayMdnsView = Object.freeze({
  state: 'unavailable',
  advertised: false,
  hostname: null,
  serviceType: '_rest-otm._tcp.local',
  port: 8787,
  addresses: 0,
  reason: 'GATEWAY_STATUS_UNAVAILABLE',
});

const STATES = new Set(['disabled', 'probing', 'announced', 'collision', 'failed', 'stopped']);
const REASONS = new Set([null, 'NO_LAN_ADDRESS', 'HOSTNAME_COLLISION', 'SOCKET_ERROR']);

function validHostname(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 253 || !value.endsWith('.local')) return false;
  return value.split('.').every((label) => (
    label.length >= 1
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ));
}

function parseStatus(value: unknown): GatewayMdnsView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  if (root.status !== 'ok' || root.service !== 'restotm-lan-gateway') return null;
  const raw = root.discovery;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const discovery = raw as Record<string, unknown>;
  if (
    typeof discovery.state !== 'string'
    || !STATES.has(discovery.state)
    || discovery.serviceType !== '_rest-otm._tcp.local'
    || discovery.port !== 8787
    || !Number.isSafeInteger(discovery.addresses)
    || (discovery.addresses as number) < 0
    || (discovery.addresses as number) > 256
    // discovery.reason 'unknown' turunde (Record<string, unknown>'dan geliyor).
    // Set.has calisma zamaninda tip guvenli karsilastirma yapar; kumede olmayan
    // bir deger dogru sekilde false doner. Cast yalnizca TS'i tatmin eder,
    // davranis degismez — fonksiyonun geri kalani ayni deseni kullaniyor.
    || !REASONS.has(discovery.reason as string | null)
    || (discovery.hostname !== null && !validHostname(discovery.hostname))
  ) return null;
  return {
    state: discovery.state as Exclude<GatewayMdnsState, 'unavailable'>,
    advertised: discovery.state === 'announced',
    hostname: discovery.hostname as string | null,
    serviceType: '_rest-otm._tcp.local',
    port: 8787,
    addresses: discovery.addresses as number,
    reason: discovery.reason as Exclude<GatewayMdnsReason, 'GATEWAY_STATUS_UNAVAILABLE'>,
  };
}

export class GatewayMdnsStatusClient implements GatewayMdnsStatusProvider {
  constructor(
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 500,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 2_000) {
      throw new Error('Gateway mDNS status timeout 100..2000 ms olmali.');
    }
  }

  async getStatus(): Promise<GatewayMdnsView> {
    try {
      const response = await this.fetcher(GATEWAY_STATUS_URL, {
        method: 'GET',
        redirect: 'error',
        // 'cache' alani kaldirildi: bu proje DOM lib'ini degil Node'un
        // undici tabanli fetch tipini kullaniyor (tsconfig.base.json lib:
        // ES2022) ve undici HTTP cache semantigini uygulamiyor — alan zaten
        // calisma zamaninda etkisizdi, sadece TS tipini karsilamiyordu.
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: 'application/json' },
      });
      const declaredLength = Number(response.headers.get('content-length') || '0');
      if (
        !response.ok
        || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')
        || !Number.isSafeInteger(declaredLength)
        || declaredLength < 0
        || declaredLength > MAX_STATUS_BYTES
      ) return FALLBACK;
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_STATUS_BYTES) return FALLBACK;
      return parseStatus(JSON.parse(text)) ?? FALLBACK;
    } catch {
      return FALLBACK;
    }
  }
}

export function unavailableGatewayMdnsStatus(): GatewayMdnsView {
  return { ...FALLBACK };
}
