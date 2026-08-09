import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { GatewayConfig, GatewayTarget, GatewayTargetName } from './config';
import { isLocalPrivateIpHost } from './config';
import type { MdnsStatus } from './mdns';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function json(response: ServerResponse, statusCode: number, code: string): void {
  const body = JSON.stringify({ success: false, error: { code } });
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function requestPath(request: IncomingMessage): string | undefined {
  const raw = request.url;
  if (!raw || raw.length > 16_384 || /[\0\r\n]/.test(raw) || !raw.startsWith('/')) return undefined;
  try {
    return new URL(raw, 'http://gateway.invalid').pathname;
  } catch {
    return undefined;
  }
}

export function classifyGatewayRoute(pathname: string): GatewayTargetName {
  if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/socket.io' || pathname.startsWith('/socket.io/')) return 'api';
  if (pathname === '/garson' || pathname.startsWith('/garson/')) return 'waiter';
  if (pathname === '/menu' || pathname.startsWith('/menu/')) return 'menu';
  return 'admin';
}

interface AcceptedHost {
  hostname: string;
  authority: string;
}

function hostFromHeader(value: string): AcceptedHost | undefined {
  if (!value || value.length > 255 || /[\s/\\?#@\0\r\n]/.test(value)) return undefined;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return undefined;
    return {
      hostname: parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase(),
      authority: parsed.host.toLowerCase(),
    };
  } catch {
    return undefined;
  }
}

function requestHost(request: IncomingMessage, config: GatewayConfig): AcceptedHost | undefined {
  const rawHost = request.headers.host;
  if (!rawHost) return undefined;
  const accepted = hostFromHeader(rawHost);
  if (!accepted) return undefined;
  if (config.allowedHosts.has(accepted.hostname)) return accepted;
  if (config.allowPrivateIpHosts && isLocalPrivateIpHost(accepted.hostname)) return accepted;
  return undefined;
}

function originMatchesHost(request: IncomingMessage, acceptedHost: AcceptedHost): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (Array.isArray(origin) || origin.length > 512) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' || parsed.username || parsed.password) return false;
    return parsed.host.toLowerCase() === acceptedHost.authority;
  } catch {
    return false;
  }
}

function filteredHeaders(request: IncomingMessage, target: GatewayTarget): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower.startsWith('x-forwarded-') || value === undefined) continue;
    headers[lower] = value;
  }

  const remoteAddress = request.socket.remoteAddress || 'unknown';
  headers.host = target.hostname.includes(':')
    ? `[${target.hostname}]:${target.port}`
    : `${target.hostname}:${target.port}`;
  headers['x-forwarded-for'] = remoteAddress;
  headers['x-forwarded-host'] = request.headers.host;
  headers['x-forwarded-proto'] = 'http';
  headers['x-restotm-gateway'] = '1';
  return headers;
}

function copyResponseHeaders(upstream: IncomingMessage, response: ServerResponse): void {
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    response.setHeader(name, value);
  }
}

function validateContentLength(request: IncomingMessage, config: GatewayConfig): boolean {
  const raw = request.headers['content-length'];
  if (raw === undefined) return true;
  if (Array.isArray(raw) || !/^\d+$/.test(raw)) return false;
  const length = Number(raw);
  return Number.isSafeInteger(length) && length >= 0 && length <= config.maxContentLengthBytes;
}

function proxyHttp(request: IncomingMessage, response: ServerResponse, target: GatewayTarget, config: GatewayConfig): void {
  const upstreamRequest = http.request({
    hostname: target.hostname,
    port: target.port,
    method: request.method,
    path: request.url,
    headers: filteredHeaders(request, target),
    timeout: config.upstreamTimeoutMs,
  }, (upstreamResponse) => {
    copyResponseHeaders(upstreamResponse, response);
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.statusMessage);
    upstreamResponse.pipe(response);
  });

  upstreamRequest.once('timeout', () => {
    upstreamRequest.destroy(new Error('UPSTREAM_TIMEOUT'));
  });
  upstreamRequest.once('error', () => {
    if (!response.headersSent) json(response, 502, 'UPSTREAM_UNAVAILABLE');
    else response.destroy();
  });
  request.once('aborted', () => upstreamRequest.destroy());
  request.pipe(upstreamRequest);
}

function rawUpgradeResponse(upstream: IncomingMessage): Buffer {
  const lines = [`HTTP/1.1 ${upstream.statusCode || 101} ${upstream.statusMessage || 'Switching Protocols'}`];
  for (let index = 0; index < upstream.rawHeaders.length; index += 2) {
    const name = upstream.rawHeaders[index];
    const value = upstream.rawHeaders[index + 1];
    if (!name || value === undefined) continue;
    lines.push(`${name}: ${value}`);
  }
  lines.push('', '');
  return Buffer.from(lines.join('\r\n'), 'latin1');
}

function rejectSocket(socket: Duplex, statusCode: number, reason: string): void {
  if (!socket.destroyed) {
    socket.end(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
}

function proxyWebSocket(request: IncomingMessage, clientSocket: Duplex, head: Buffer, target: GatewayTarget, config: GatewayConfig): void {
  const headers = filteredHeaders(request, target);
  headers.connection = 'Upgrade';
  headers.upgrade = 'websocket';

  const upstreamRequest = http.request({
    hostname: target.hostname,
    port: target.port,
    method: request.method,
    path: request.url,
    headers,
    timeout: config.upstreamTimeoutMs,
  });

  upstreamRequest.once('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
    clientSocket.write(rawUpgradeResponse(upstreamResponse));
    if (upstreamHead.length > 0) clientSocket.write(upstreamHead);
    if (head.length > 0) upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });
  upstreamRequest.once('response', (upstreamResponse) => {
    rejectSocket(clientSocket, upstreamResponse.statusCode || 502, 'Upgrade Rejected');
    upstreamResponse.resume();
  });
  upstreamRequest.once('timeout', () => upstreamRequest.destroy(new Error('UPSTREAM_TIMEOUT')));
  upstreamRequest.once('error', () => rejectSocket(clientSocket, 502, 'Bad Gateway'));
  clientSocket.once('error', () => upstreamRequest.destroy());
  upstreamRequest.end();
}

export function createGatewayServer(
  config: GatewayConfig,
  options: { discoveryStatus?: () => MdnsStatus } = {},
): http.Server {
  const server = http.createServer({
    maxHeaderSize: 16 * 1024,
    requireHostHeader: true,
    requestTimeout: config.upstreamTimeoutMs + 5_000,
    headersTimeout: Math.min(config.upstreamTimeoutMs, 15_000),
  }, (request, response) => {
    const pathname = requestPath(request);
    const acceptedHost = requestHost(request, config);
    if (!pathname || !acceptedHost) {
      json(response, 400, 'INVALID_GATEWAY_REQUEST');
      return;
    }
    if (!originMatchesHost(request, acceptedHost)) {
      json(response, 403, 'CROSS_ORIGIN_REQUEST_REJECTED');
      return;
    }
    if (!validateContentLength(request, config)) {
      json(response, 413, 'REQUEST_TOO_LARGE');
      return;
    }
    if (pathname === '/__restotm/health') {
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      response.end(JSON.stringify({
        status: 'ok',
        service: 'restotm-lan-gateway',
        ...(options.discoveryStatus ? { discovery: options.discoveryStatus() } : {}),
      }));
      return;
    }

    const target = config.targets[classifyGatewayRoute(pathname)];
    proxyHttp(request, response, target, config);
  });

  server.on('upgrade', (request, socket, head) => {
    const pathname = requestPath(request);
    const acceptedHost = requestHost(request, config);
    if (
      !pathname
      || !acceptedHost
      || (pathname !== '/socket.io' && !pathname.startsWith('/socket.io/'))
      || !originMatchesHost(request, acceptedHost)
    ) {
      rejectSocket(socket, 403, 'Forbidden');
      return;
    }
    proxyWebSocket(request, socket, head, config.targets.api, config);
  });

  server.on('clientError', (_error, socket) => rejectSocket(socket, 400, 'Bad Request'));
  return server;
}
