import { createGatewayServer } from './gateway';
import { loadGatewayConfig } from './config';

const config = loadGatewayConfig();
const server = createGatewayServer(config);

server.listen(config.port, config.bindHost, () => {
  console.log(JSON.stringify({
    level: 'info',
    event: 'gateway.started',
    bindHost: config.bindHost,
    port: config.port,
  }));
});

const shutdown = (signal: string): void => {
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
