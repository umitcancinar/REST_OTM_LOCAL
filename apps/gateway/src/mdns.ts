import dgram, { type RemoteInfo, type Socket } from 'node:dgram';
import { isIP } from 'node:net';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type { MdnsConfig } from './config';

const MDNS_PORT = 5353;
const MDNS_IPV4_GROUP = '224.0.0.251';
const MDNS_IPV6_GROUP = 'ff02::fb';
const DNS_CLASS_IN = 1;
const DNS_CACHE_FLUSH = 0x8000;
const DNS_TYPE_A = 1;
const DNS_TYPE_PTR = 12;
const DNS_TYPE_TXT = 16;
const DNS_TYPE_AAAA = 28;
const DNS_TYPE_SRV = 33;
const DNS_TYPE_ANY = 255;
const DNS_SD_ENUMERATION = '_services._dns-sd._udp.local';

export interface MdnsLanAddress {
  address: string;
  family: 'IPv4' | 'IPv6';
  interfaceName: string;
}

export type MdnsState = 'disabled' | 'probing' | 'announced' | 'collision' | 'failed' | 'stopped';

export interface MdnsStatus {
  state: MdnsState;
  hostname: string | null;
  serviceType: string;
  port: number;
  addresses: number;
  reason: 'NO_LAN_ADDRESS' | 'HOSTNAME_COLLISION' | 'SOCKET_ERROR' | null;
}

interface NetworkProvider {
  getNetworkInterfaces(): NodeJS.Dict<NetworkInterfaceInfo[]>;
}

interface MdnsSocket {
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'message', listener: (message: Buffer, remote: RemoteInfo) => void): this;
  bind(port: number, address: string, callback: () => void): void;
  addMembership(multicastAddress: string, multicastInterface?: string): void;
  setMulticastTTL(ttl: number): void;
  setMulticastLoopback(flag: boolean): void;
  send(message: Buffer, port: number, address: string, callback?: (error: Error | null) => void): void;
  close(): void;
}

interface MdnsDependencies {
  networkProvider?: NetworkProvider;
  createSocket?: (family: 'udp4' | 'udp6') => MdnsSocket;
  probeIntervalMs?: number;
  schedule?: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  cancel?: (timer: NodeJS.Timeout) => void;
  now?: () => number;
  log?: (entry: Record<string, unknown>) => void;
}

class OsNetworkProvider implements NetworkProvider {
  getNetworkInterfaces(): NodeJS.Dict<NetworkInterfaceInfo[]> {
    return networkInterfaces();
  }
}

function isAllowedIpv4(address: string): boolean {
  const values = address.split('.').map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  return values[0] === 10
    || (values[0] === 172 && (values[1] ?? -1) >= 16 && (values[1] ?? 32) <= 31)
    || (values[0] === 192 && values[1] === 168)
    || (values[0] === 169 && values[1] === 254);
}

function isAllowedIpv6(address: string): boolean {
  const first = Number.parseInt(address.split(':', 1)[0] ?? '', 16);
  return (first >= 0xfc00 && first <= 0xfdff) || (first >= 0xfe80 && first <= 0xfebf);
}

export function discoverMdnsLanAddresses(
  provider: NetworkProvider = new OsNetworkProvider(),
): MdnsLanAddress[] {
  const found = new Map<string, MdnsLanAddress>();
  for (const [interfaceName, entries] of Object.entries(provider.getNetworkInterfaces())) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.internal) continue;
      const runtimeFamily: unknown = entry.family;
      const family = runtimeFamily === 'IPv4' || runtimeFamily === 4
        ? 'IPv4'
        : runtimeFamily === 'IPv6' || runtimeFamily === 6 ? 'IPv6' : null;
      if (!family) continue;
      const address = entry.address.toLowerCase().split('%', 1)[0] ?? '';
      if (isIP(address) === 0) continue;
      if (family === 'IPv4' ? !isAllowedIpv4(address) : !isAllowedIpv6(address)) continue;
      found.set(`${family}:${address}`, { address, family, interfaceName });
    }
  }
  return [...found.values()].sort((left, right) => (
    left.family === right.family
      ? left.address.localeCompare(right.address, 'en')
      : left.family === 'IPv4' ? -1 : 1
  ));
}

function encodeName(name: string): Buffer {
  const labels = name.replace(/\.$/, '').split('.');
  const parts: Buffer[] = [];
  for (const label of labels) {
    const bytes = Buffer.from(label, 'utf8');
    if (bytes.length === 0 || bytes.length > 63) throw new Error('MDNS_LABEL_INVALID');
    parts.push(Buffer.from([bytes.length]), bytes);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function ipv4Bytes(address: string): Buffer {
  return Buffer.from(address.split('.').map(Number));
}

function ipv6Bytes(address: string): Buffer {
  const [head = '', tail = ''] = address.split('::', 2);
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0 || (!address.includes('::') && missing !== 0)) throw new Error('MDNS_IPV6_INVALID');
  const parts = [...headParts, ...Array.from({ length: missing }, () => '0'), ...tailParts];
  const result = Buffer.alloc(16);
  parts.forEach((part, index) => result.writeUInt16BE(Number.parseInt(part || '0', 16), index * 2));
  return result;
}

function canonicalAddress(address: string): string {
  if (isIP(address) === 4) return address;
  if (isIP(address) === 6) return ipv6Bytes(address).toString('hex');
  return '';
}

function txtBytes(values: readonly string[]): Buffer {
  const records: Buffer[] = [];
  for (const value of values) {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length > 255) throw new Error('MDNS_TXT_INVALID');
    records.push(Buffer.from([bytes.length]), bytes);
  }
  return Buffer.concat(records);
}

function record(name: string, type: number, ttl: number, data: Buffer, flush = true): Buffer {
  const header = Buffer.alloc(10);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(DNS_CLASS_IN | (flush ? DNS_CACHE_FLUSH : 0), 2);
  header.writeUInt32BE(ttl, 4);
  header.writeUInt16BE(data.length, 8);
  return Buffer.concat([encodeName(name), header, data]);
}

export function buildMdnsAnnouncement(
  config: MdnsConfig,
  addresses: readonly MdnsLanAddress[],
  ttlSeconds = config.ttlSeconds,
): Buffer {
  const instance = `${config.instanceName}.${config.serviceType}`;
  const srv = Buffer.alloc(6);
  srv.writeUInt16BE(config.port, 4);
  const answers = [
    record(DNS_SD_ENUMERATION, DNS_TYPE_PTR, ttlSeconds, encodeName(config.serviceType), false),
    record(config.serviceType, DNS_TYPE_PTR, ttlSeconds, encodeName(instance), false),
    record(instance, DNS_TYPE_SRV, ttlSeconds, Buffer.concat([srv, encodeName(config.hostname)])),
    record(instance, DNS_TYPE_TXT, ttlSeconds, txtBytes([
      'schema=1',
      'scope=lan',
      'admin=/',
      'waiter=/garson',
      'menu=/menu',
    ])),
    ...addresses.map((entry) => record(
      config.hostname,
      entry.family === 'IPv4' ? DNS_TYPE_A : DNS_TYPE_AAAA,
      ttlSeconds,
      entry.family === 'IPv4' ? ipv4Bytes(entry.address) : ipv6Bytes(entry.address),
    )),
  ];
  const dnsHeader = Buffer.alloc(12);
  dnsHeader.writeUInt16BE(0x8400, 2);
  dnsHeader.writeUInt16BE(answers.length, 6);
  return Buffer.concat([dnsHeader, ...answers]);
}

export function buildMdnsProbe(hostname: string): Buffer {
  const dnsHeader = Buffer.alloc(12);
  dnsHeader.writeUInt16BE(1, 4);
  const question = Buffer.alloc(4);
  question.writeUInt16BE(DNS_TYPE_ANY, 0);
  question.writeUInt16BE(DNS_CLASS_IN, 2);
  return Buffer.concat([dnsHeader, encodeName(hostname), question]);
}

interface DecodedName { name: string; next: number }

function decodeName(packet: Buffer, start: number, depth = 0): DecodedName {
  if (depth > 8) throw new Error('MDNS_POINTER_DEPTH');
  const labels: string[] = [];
  let offset = start;
  let next = start;
  let jumped = false;
  for (let count = 0; count < 128; count += 1) {
    if (offset >= packet.length) throw new Error('MDNS_NAME_BOUNDS');
    const length = packet[offset] ?? 0;
    if ((length & 0xc0) === 0xc0) {
      if (offset + 1 >= packet.length) throw new Error('MDNS_POINTER_BOUNDS');
      const pointer = ((length & 0x3f) << 8) | (packet[offset + 1] ?? 0);
      if (!jumped) next = offset + 2;
      const nested = decodeName(packet, pointer, depth + 1);
      if (nested.name) labels.push(nested.name);
      jumped = true;
      return { name: labels.join('.').toLowerCase(), next };
    }
    offset += 1;
    if (length === 0) {
      if (!jumped) next = offset;
      return { name: labels.join('.').toLowerCase(), next };
    }
    if (length > 63 || offset + length > packet.length) throw new Error('MDNS_LABEL_BOUNDS');
    labels.push(packet.subarray(offset, offset + length).toString('utf8'));
    offset += length;
    if (!jumped) next = offset;
  }
  throw new Error('MDNS_NAME_TOO_LONG');
}

interface ParsedPacket {
  questions: string[];
  hostAddresses: Array<{ name: string; address: string }>;
  srvTargets: Array<{ name: string; target: string }>;
}

function parseMdnsPacket(packet: Buffer): ParsedPacket {
  if (packet.length < 12 || packet.length > 9000) throw new Error('MDNS_PACKET_SIZE');
  const questionCount = packet.readUInt16BE(4);
  const recordCount = packet.readUInt16BE(6) + packet.readUInt16BE(8) + packet.readUInt16BE(10);
  if (questionCount > 64 || recordCount > 256) throw new Error('MDNS_COUNT_LIMIT');
  let offset = 12;
  const questions: string[] = [];
  for (let index = 0; index < questionCount; index += 1) {
    const decoded = decodeName(packet, offset);
    offset = decoded.next;
    if (offset + 4 > packet.length) throw new Error('MDNS_QUESTION_BOUNDS');
    questions.push(decoded.name);
    offset += 4;
  }
  const hostAddresses: Array<{ name: string; address: string }> = [];
  const srvTargets: Array<{ name: string; target: string }> = [];
  for (let index = 0; index < recordCount; index += 1) {
    const decoded = decodeName(packet, offset);
    offset = decoded.next;
    if (offset + 10 > packet.length) throw new Error('MDNS_RECORD_BOUNDS');
    const type = packet.readUInt16BE(offset);
    const length = packet.readUInt16BE(offset + 8);
    const dataOffset = offset + 10;
    const dataEnd = dataOffset + length;
    if (dataEnd > packet.length) throw new Error('MDNS_RDATA_BOUNDS');
    if (type === DNS_TYPE_A && length === 4) {
      hostAddresses.push({ name: decoded.name, address: [...packet.subarray(dataOffset, dataEnd)].join('.') });
    } else if (type === DNS_TYPE_AAAA && length === 16) {
      const groups: string[] = [];
      for (let cursor = dataOffset; cursor < dataEnd; cursor += 2) groups.push(packet.readUInt16BE(cursor).toString(16));
      hostAddresses.push({ name: decoded.name, address: groups.join(':') });
    } else if (type === DNS_TYPE_SRV && length >= 7) {
      const target = decodeName(packet, dataOffset + 6);
      srvTargets.push({ name: decoded.name, target: target.name });
    }
    offset = dataEnd;
  }
  return { questions, hostAddresses, srvTargets };
}

export class MdnsDiscovery {
  private readonly addresses: MdnsLanAddress[];
  private readonly sockets: Array<{ socket: MdnsSocket; family: 'udp4' | 'udp6' }> = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  private state: MdnsState;
  private reason: MdnsStatus['reason'] = null;
  private probesSent = 0;
  private stopped = false;
  private readonly createSocket: (family: 'udp4' | 'udp6') => MdnsSocket;
  private readonly schedule: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  private readonly cancel: (timer: NodeJS.Timeout) => void;
  private readonly log: (entry: Record<string, unknown>) => void;
  private readonly now: () => number;
  private readonly probeIntervalMs: number;
  private lastQueryResponseAt = 0;

  constructor(private readonly config: MdnsConfig, dependencies: MdnsDependencies = {}) {
    this.addresses = discoverMdnsLanAddresses(dependencies.networkProvider);
    this.createSocket = dependencies.createSocket ?? ((family) => dgram.createSocket({ type: family, reuseAddr: true }) as Socket);
    this.schedule = dependencies.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.cancel = dependencies.cancel ?? clearTimeout;
    this.now = dependencies.now ?? Date.now;
    this.log = dependencies.log ?? ((entry) => {
      const serialized = JSON.stringify(entry);
      if (entry.level === 'warning' || entry.level === 'error') console.error(serialized);
      else console.log(serialized);
    });
    this.probeIntervalMs = dependencies.probeIntervalMs ?? 250;
    this.state = config.enabled ? 'probing' : 'disabled';
  }

  status(): MdnsStatus {
    return {
      state: this.state,
      hostname: this.config.enabled ? this.config.hostname : null,
      serviceType: this.config.serviceType,
      port: this.config.port,
      addresses: this.addresses.length,
      reason: this.reason,
    };
  }

  start(): void {
    if (!this.config.enabled || this.stopped) return;
    if (this.addresses.length === 0) {
      this.fail('NO_LAN_ADDRESS', 'warning');
      return;
    }
    // Dual-stack makinelerde tek responder tercih edilir; ayni announcement
    // kayitlari A ve AAAA cevaplarini birlikte tasir. IPv4 yoksa IPv6-only LAN
    // multicast transportuna duser.
    if (this.addresses.some((entry) => entry.family === 'IPv4')) this.openSocket('udp4');
    else this.openSocket('udp6');
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const timer of this.timers) this.cancel(timer);
    this.timers.clear();
    if (this.state === 'announced') this.broadcast(buildMdnsAnnouncement(this.config, this.addresses, 0));
    for (const { socket } of this.sockets) {
      try { socket.close(); } catch { /* already closed */ }
    }
    this.sockets.length = 0;
    this.state = 'stopped';
  }

  private openSocket(family: 'udp4' | 'udp6'): void {
    let socket: MdnsSocket;
    try {
      socket = this.createSocket(family);
      this.sockets.push({ socket, family });
      socket.on('error', () => this.fail('SOCKET_ERROR', 'warning'));
      socket.on('message', (message) => this.handleMessage(message));
      socket.bind(MDNS_PORT, family === 'udp4' ? '0.0.0.0' : '::', () => {
        if (this.stopped) return;
        try {
          const group = family === 'udp4' ? MDNS_IPV4_GROUP : MDNS_IPV6_GROUP;
          const familyAddresses = this.addresses.filter((entry) => entry.family === (family === 'udp4' ? 'IPv4' : 'IPv6'));
          for (const entry of familyAddresses) socket.addMembership(group, entry.address);
          socket.setMulticastTTL(255);
          socket.setMulticastLoopback(false);
          this.probe();
        } catch {
          this.fail('SOCKET_ERROR', 'warning');
        }
      });
    } catch {
      this.fail('SOCKET_ERROR', 'warning');
    }
  }

  private probe(): void {
    if (this.stopped || this.state !== 'probing') return;
    this.probesSent += 1;
    this.broadcast(buildMdnsProbe(this.config.hostname));
    if (this.probesSent >= 3) {
      const timer = this.schedule(() => {
        this.timers.delete(timer);
        if (this.stopped || this.state !== 'probing') return;
        this.state = 'announced';
        this.broadcast(buildMdnsAnnouncement(this.config, this.addresses));
        this.log({ level: 'info', event: 'gateway.mdns_announced', serviceType: this.config.serviceType, port: this.config.port });
      }, this.probeIntervalMs);
      this.timers.add(timer);
      return;
    }
    const timer = this.schedule(() => {
      this.timers.delete(timer);
      this.probe();
    }, this.probeIntervalMs);
    this.timers.add(timer);
  }

  private handleMessage(message: Buffer): void {
    if (this.stopped || ['collision', 'failed'].includes(this.state)) return;
    let parsed: ParsedPacket;
    try { parsed = parseMdnsPacket(message); } catch { return; }
    const ownAddresses = new Set(this.addresses.map((entry) => canonicalAddress(entry.address)));
    const hostname = this.config.hostname.toLowerCase();
    const instance = `${this.config.instanceName}.${this.config.serviceType}`.toLowerCase();
    const addressCollision = parsed.hostAddresses.some((entry) => (
      entry.name === hostname && !ownAddresses.has(canonicalAddress(entry.address))
    ));
    const instanceCollision = parsed.srvTargets.some((entry) => entry.name === instance && entry.target !== hostname);
    if (addressCollision || instanceCollision) {
      this.fail('HOSTNAME_COLLISION', 'error', 'collision');
      return;
    }
    const queryMatches = parsed.questions.some((question) => (
      question === this.config.serviceType.toLowerCase()
      || question === DNS_SD_ENUMERATION
      || question === instance
      || question === hostname
    ));
    const now = this.now();
    if (this.state === 'announced' && queryMatches && now - this.lastQueryResponseAt >= 1_000) {
      this.lastQueryResponseAt = now;
      this.broadcast(buildMdnsAnnouncement(this.config, this.addresses));
    }
  }

  private broadcast(message: Buffer): void {
    for (const { socket, family } of this.sockets) {
      const address = family === 'udp6' ? MDNS_IPV6_GROUP : MDNS_IPV4_GROUP;
      try {
        socket.send(message, MDNS_PORT, address, (error) => {
          if (error) this.fail('SOCKET_ERROR', 'warning');
        });
      } catch {
        this.fail('SOCKET_ERROR', 'warning');
      }
    }
  }

  private fail(reason: MdnsStatus['reason'], level: 'warning' | 'error', state: MdnsState = 'failed'): void {
    if (this.stopped || this.state === 'failed' || this.state === 'collision') return;
    this.reason = reason;
    this.state = state;
    for (const timer of this.timers) this.cancel(timer);
    this.timers.clear();
    for (const { socket } of this.sockets) {
      try { socket.close(); } catch { /* already closed */ }
    }
    this.sockets.length = 0;
    this.log({ level, event: 'gateway.mdns_unavailable', code: reason, fallback: 'DIRECT_LAN_IP' });
  }
}

export function startMdnsDiscovery(config: MdnsConfig, dependencies: MdnsDependencies = {}): MdnsDiscovery {
  const discovery = new MdnsDiscovery(config, dependencies);
  discovery.start();
  return discovery;
}
