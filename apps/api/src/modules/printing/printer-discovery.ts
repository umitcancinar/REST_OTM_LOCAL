import net from 'net';
import os, { NetworkInterfaceInfo } from 'os';
import { performance } from 'perf_hooks';

const RAW_PRINT_PORT = 9100;
const DEFAULT_TIMEOUT_MS = 350;
const DEFAULT_CONCURRENCY = 64;
const MIN_SCAN_PREFIX = 24;
const MAX_SCAN_ADDRESSES = 1024;

export interface DiscoveredPrinter {
  ipAddress: string;
  port: number;
  latencyMs: number;
}

export interface PrinterDiscoveryResult {
  printers: DiscoveredPrinter[];
  scannedAddressCount: number;
  networkCount: number;
  durationMs: number;
}

type InterfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>;
type PortProbe = (ipAddress: string, port: number, timeoutMs: number) => Promise<number | null>;

function ipv4ToNumber(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = ((result << 8) | octet) >>> 0;
  }
  return result;
}

function numberToIpv4(value: number): string {
  const normalized = value >>> 0;
  return [24, 16, 8, 0].map((shift) => (normalized >>> shift) & 255).join('.');
}

function isPrivateIpv4(value: number): boolean {
  const first = value >>> 24;
  const second = (value >>> 16) & 255;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function prefixFromNetmask(netmask: string): number | null {
  const mask = ipv4ToNumber(netmask);
  if (mask === null) return null;
  const inverted = (~mask) >>> 0;
  if ((inverted & ((inverted + 1) >>> 0)) !== 0) return null;
  let prefix = 0;
  for (let bit = 31; bit >= 0; bit -= 1) {
    if (((mask >>> bit) & 1) === 1) prefix += 1;
    else break;
  }
  return prefix;
}

/**
 * Yalniz makinenin dogrudan bagli RFC1918 aglarini tarar. Cok genis /8-/16
 * aglarda tum kurumu taramak yerine makinenin kendi /24 dilimiyle sinirlanir.
 * Kullanici girdisi, public adres, hostname, MAC veya serbest port kabul etmez.
 */
export function localPrinterScanTargets(interfaces: InterfaceMap): string[] {
  const targets = new Set<number>();
  const eligibleInterfaces: Array<{ address: number; configuredPrefix: number }> = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4') continue;
      const address = ipv4ToNumber(entry.address);
      const configuredPrefix = prefixFromNetmask(entry.netmask);
      if (address === null || configuredPrefix === null || !isPrivateIpv4(address)) continue;
      eligibleInterfaces.push({ address, configuredPrefix });
    }
  }
  const localAddresses = new Set(eligibleInterfaces.map((entry) => entry.address));

  for (const { address, configuredPrefix } of eligibleInterfaces) {
    const prefix = Math.max(configuredPrefix, MIN_SCAN_PREFIX);
    if (prefix >= 31) continue;
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    const network = (address & mask) >>> 0;
    const broadcast = (network | (~mask)) >>> 0;
    for (let candidate = network + 1; candidate < broadcast; candidate += 1) {
      const normalized = candidate >>> 0;
      if (!localAddresses.has(normalized) && isPrivateIpv4(normalized)) targets.add(normalized);
      if (targets.size >= MAX_SCAN_ADDRESSES) break;
    }
    if (targets.size >= MAX_SCAN_ADDRESSES) break;
  }

  return [...targets].sort((left, right) => left - right).map(numberToIpv4);
}

async function probeRawPrintPort(
  ipAddress: string,
  port: number,
  timeoutMs: number,
): Promise<number | null> {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (connected: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected ? Math.max(1, Math.round(performance.now() - startedAt)) : null);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, ipAddress);
  });
}

export async function discoverLocalPrinters(options: {
  interfaces?: InterfaceMap;
  probe?: PortProbe;
  timeoutMs?: number;
  concurrency?: number;
} = {}): Promise<PrinterDiscoveryResult> {
  const startedAt = performance.now();
  const interfaces = options.interfaces ?? os.networkInterfaces();
  const targets = localPrinterScanTargets(interfaces);
  const probe = options.probe ?? probeRawPrintPort;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 1_000) {
    throw new Error('Printer discovery timeout contract is invalid.');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 128) {
    throw new Error('Printer discovery concurrency contract is invalid.');
  }

  const found: DiscoveredPrinter[] = [];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < targets.length) {
      const targetIndex = cursor;
      cursor += 1;
      const ipAddress = targets[targetIndex];
      if (!ipAddress) continue;
      const latencyMs = await probe(ipAddress, RAW_PRINT_PORT, timeoutMs);
      if (latencyMs !== null) found.push({ ipAddress, port: RAW_PRINT_PORT, latencyMs });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()),
  );

  found.sort((left, right) => {
    const leftValue = ipv4ToNumber(left.ipAddress) ?? 0;
    const rightValue = ipv4ToNumber(right.ipAddress) ?? 0;
    return leftValue - rightValue;
  });
  const privateNetworks = new Set(
    Object.values(interfaces).flatMap((entries) => (entries ?? []))
      .filter((entry) => !entry.internal && entry.family === 'IPv4')
      .map((entry) => ipv4ToNumber(entry.address))
      .filter((address): address is number => address !== null && isPrivateIpv4(address))
      .map((address) => address >>> 8),
  );

  return {
    printers: found,
    scannedAddressCount: targets.length,
    networkCount: privateNetworks.size,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}
