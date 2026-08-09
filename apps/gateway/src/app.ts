import { createGatewayServer } from './gateway';
import { loadGatewayConfig } from './config';
import { startMdnsDiscovery, type MdnsDiscovery } from './mdns';

const config = loadGatewayConfig();
let discovery: MdnsDiscovery | undefined;
const server = createGatewayServer(config, {
  discoveryStatus: () => discovery?.status() ?? {
    state: config.mdns.enabled ? 'probing' : 'disabled',
    hostname: config.mdns.enabled ? config.mdns.hostname : null,
    serviceType: config.mdns.serviceType,
    port: config.mdns.port,
    addresses: 0,
    reason: null,
  },
});

server.listen(config.port, config.bindHost, () => {
  discovery = startMdnsDiscovery(config.mdns);
  console.log(JSON.stringify({
    level: 'info',
    event: 'gateway.started',
    bindHost: config.bindHost,
    port: config.port,
  }));
});

const shutdown = (signal: string): void => {
  discovery?.stop();
  server.close((error) => {
    if (error) {
      console.error(JSON.stringify({ level: 'error', event: 'gateway.shutdown_failed', signal }));
      process.exitCode = 1;
      return;
    }
    process.exitCode = 0;
  });
  setTimeout(() => {
    console.error(JSON.stringify({ level: 'error', event: 'gateway.shutdown_timeout', signal }));
    process.exit(1);
  }, 10_000).unref();
};

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
