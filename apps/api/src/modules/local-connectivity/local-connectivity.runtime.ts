import { isIP } from 'node:net';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import QRCode from 'qrcode';

export const LOCAL_GATEWAY_PORT = 8787 as const;

export type LocalConnectivityTarget = 'admin' | 'waiter' | 'health';

export interface NetworkInterfacesProvider {
  getNetworkInterfaces(): NodeJS.Dict<NetworkInterfaceInfo[]>;
}

export interface QrSvgOptions {
  type: 'svg';
  errorCorrectionLevel: 'M';
  margin: 4;
  width: 320;
  color: { dark: '#111827'; light: '#FFFFFF' };
}

export interface QrSvgEncoder {
  toSvg(value: string, options: QrSvgOptions): Promise<string>;
}

export interface LocalLanAddressView {
  address: string;
  family: 'IPv4' | 'IPv6';
  urls: LocalConnectivityUrls;
}

export interface LocalConnectivityUrls {
  admin: string;
  waiter: string;
  health: string;
}

export interface LocalConnectivityStatus {
  online: boolean;
  hostname: string;
  gatewayPort: typeof LOCAL_GATEWAY_PORT;
  urls: LocalConnectivityUrls;
  addresses: LocalLanAddressView[];
  warning: { code: 'LAN_ADDRESS_UNAVAILABLE'; message: string } | null;
  qr: {
    endpoint: '/api/local-connectivity/qr.svg';
    defaultTarget: 'waiter';
    allowedTargets: readonly LocalConnectivityTarget[];
  };
  blockers: {
    mdnsAdvertising: 'NOT_IMPLEMENTED';
    tauriUi: 'NOT_IMPLEMENTED';
  };
}

export class LocalConnectivityError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'LocalConnectivityError';
  }
}

class OsNetworkInterfacesProvider implements NetworkInterfacesProvider {
  getNetworkInterfaces(): NodeJS.Dict<NetworkInterfaceInfo[]> {
    return networkInterfaces();
  }
}

class OfficialQrSvgEncoder implements QrSvgEncoder {
  async toSvg(value: string, options: QrSvgOptions): Promise<string> {
    return QRCode.toString(value, options);
  }
}

const TARGET_PATHS: Record<LocalConnectivityTarget, string> = {
  admin: '/',
  waiter: '/garson',
  health: '/api/health',
};

const ALLOWED_TARGETS = Object.freeze([
  'admin',
  'waiter',
  'health',
] as const satisfies readonly LocalConnectivityTarget[]);

const QR_OPTIONS: QrSvgOptions = Object.freeze({
  type: 'svg',
  errorCorrectionLevel: 'M',
  margin: 4,
  width: 320,
  color: Object.freeze({ dark: '#111827', light: '#FFFFFF' }),
});

export function validateLocalLanHostname(value: string): string {
  const hostname = value.trim().toLowerCase().replace(/\.$/, '');
  if (
    hostname.length < 1
    || hostname.length > 253
    || hostname === 'localhost'
    || isIP(hostname) !== 0
  ) {
    throw new LocalConnectivityError('INVALID_LAN_HOSTNAME', 'Local LAN hostname gecersiz.', 500);
  }
  const labels = hostname.split('.');
  if (labels.some((label) => (
    label.length < 1
    || label.length > 63
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ))) {
    throw new LocalConnectivityError('INVALID_LAN_HOSTNAME', 'Local LAN hostname gecersiz.', 500);
  }
  return hostname;
}

function isAllowedIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 169 && octets[1] === 254);
}

function isAllowedIpv6(address: string): boolean {
  const firstHextet = Number.parseInt(address.split(':', 1)[0] ?? '', 16);
  return (firstHextet >= 0xfc00 && firstHextet <= 0xfdff)
    || (firstHextet >= 0xfe80 && firstHextet <= 0xfebf);
}

function normalizeFamily(family: NetworkInterfaceInfo['family']): 'IPv4' | 'IPv6' | null {
  const runtimeFamily: unknown = family;
  if (runtimeFamily === 'IPv4' || runtimeFamily === 4) return 'IPv4';
  if (runtimeFamily === 'IPv6' || runtimeFamily === 6) return 'IPv6';
  return null;
}

function urlHost(host: string): string {
  return isIP(host) === 6 ? `[${host}]` : host;
}

function buildUrls(host: string): LocalConnectivityUrls {
  const origin = `http://${urlHost(host)}:${LOCAL_GATEWAY_PORT}`;
  return {
    admin: `${origin}${TARGET_PATHS.admin}`,
    waiter: `${origin}${TARGET_PATHS.waiter}`,
    health: `${origin}${TARGET_PATHS.health}`,
  };
}

export class LocalConnectivityRuntime {
  private readonly hostname: string;

  constructor(
    hostname: string,
    private readonly interfacesProvider: NetworkInterfacesProvider = new OsNetworkInterfacesProvider(),
    private readonly qrEncoder: QrSvgEncoder = new OfficialQrSvgEncoder(),
  ) {
    this.hostname = validateLocalLanHostname(hostname);
  }

  listAddresses(): LocalLanAddressView[] {
    const deduplicated = new Map<string, { address: string; family: 'IPv4' | 'IPv6' }>();
    const interfaces = this.interfacesProvider.getNetworkInterfaces();
    for (const entries of Object.values(interfaces)) {
      if (!entries) continue;
      for (const entry of entries) {
        if (entry.internal) continue;
        const family = normalizeFamily(entry.family);
        if (!family || isIP(entry.address) === 0) continue;
        const normalizedAddress = entry.address.toLowerCase().split('%', 1)[0] ?? '';
        const allowed = family === 'IPv4'
          ? isAllowedIpv4(normalizedAddress)
          : isAllowedIpv6(normalizedAddress);
        if (!allowed) continue;
        deduplicated.set(`${family}:${normalizedAddress}`, { address: normalizedAddress, family });
      }
    }
    return [...deduplicated.values()]
      .sort((left, right) => (
        left.family === right.family
          ? left.address < right.address ? -1 : left.address > right.address ? 1 : 0
          : left.family === 'IPv4' ? -1 : 1
      ))
      .map(({ address, family }) => ({ address, family, urls: buildUrls(address) }));
  }

  getStatus(): LocalConnectivityStatus {
    const addresses = this.listAddresses();
    return {
      online: addresses.length > 0,
      hostname: this.hostname,
      gatewayPort: LOCAL_GATEWAY_PORT,
      urls: buildUrls(this.hostname),
      addresses,
      warning: addresses.length === 0
        ? {
            code: 'LAN_ADDRESS_UNAVAILABLE',
            message: 'Aktif ve guvenli bir yerel ag adresi bulunamadi.',
          }
        : null,
      qr: {
        endpoint: '/api/local-connectivity/qr.svg',
        defaultTarget: 'waiter',
        allowedTargets: ALLOWED_TARGETS,
      },
      blockers: {
        mdnsAdvertising: 'NOT_IMPLEMENTED',
        tauriUi: 'NOT_IMPLEMENTED',
      },
    };
  }

  async createQrSvg(
    target: LocalConnectivityTarget = 'waiter',
    requestedHost?: string,
  ): Promise<{ svg: string; url: string }> {
    if (!ALLOWED_TARGETS.includes(target)) {
      throw new LocalConnectivityError('INVALID_LAN_QR_TARGET', 'QR hedefi gecersiz.');
    }
    const host = requestedHost?.trim().toLowerCase() || this.hostname;
    const allowedHosts = new Set([this.hostname, ...this.listAddresses().map((entry) => entry.address)]);
    if (!allowedHosts.has(host)) {
      throw new LocalConnectivityError('LAN_QR_HOST_NOT_AVAILABLE', 'QR icin secilen LAN adresi kullanilamiyor.', 409);
    }
    const url = buildUrls(host)[target];
    return { svg: await this.qrEncoder.toSvg(url, QR_OPTIONS), url };
  }
}
