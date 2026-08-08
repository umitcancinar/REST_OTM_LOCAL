import compression from 'compression';
import cors from 'cors';
import express, { Application } from 'express';
import helmet from 'helmet';
import { createServer, Server as HttpServer } from 'http';
import morgan from 'morgan';
import { sharedEnv, RuntimeMode } from '../config/env.shared';
import prisma from '../config/database';
import { errorHandler } from '../middlewares/errorHandler.middleware';
import { generalLimiter } from '../middlewares/rateLimiter.middleware';
import { logger } from '../utils/logger';

export type ReleaseRuntimeMode = Exclude<RuntimeMode, 'all'> | 'all';

export interface RuntimeLifecycle {
  beforeStart?(): Promise<void> | void;
  afterStart?(): Promise<void> | void;
  stop?(): Promise<void> | void;
  websocket?: boolean;
}

export interface ApiRuntime {
  app: Application;
  httpServer: HttpServer;
  start(): Promise<void>;
  shutdown(reason: string): Promise<void>;
}

export function createBaseRuntime(runtimeMode: ReleaseRuntimeMode): {
  app: Application;
  httpServer: HttpServer;
} {
  const app = express();
  const httpServer = createServer(app);

  app.set(
    'trust proxy',
    runtimeMode === 'cloud'
      ? 1
      : (ip: string) => (
          ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
        ),
  );
  app.use(helmet());
  app.use(cors({ origin: sharedEnv.CORS_ORIGIN, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan('short', { stream: { write: (message) => logger.http(message.trim()) } }));
  app.use(generalLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      message: 'REST_OTM API is running',
      version: sharedEnv.APP_VERSION,
      runtime: runtimeMode,
      ...(sharedEnv.isProd ? {} : { environment: sharedEnv.NODE_ENV }),
      timestamp: new Date().toISOString(),
    });
  });

  return { app, httpServer };
}

export function finalizeApi(app: Application): void {
  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      message: 'Route not found',
      timestamp: new Date().toISOString(),
    });
  });
  app.use(errorHandler);
}

async function listen(httpServer: HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      httpServer.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      httpServer.off('error', onError);
      resolve();
    };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(sharedEnv.PORT, sharedEnv.BIND_HOST);
  });
}

async function closeHttpServer(httpServer: HttpServer): Promise<void> {
  if (!httpServer.listening) return;
  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => error ? reject(error) : resolve());
  });
}

export function createRuntimeController(
  runtimeMode: ReleaseRuntimeMode,
  app: Application,
  httpServer: HttpServer,
  lifecycle: RuntimeLifecycle,
): ApiRuntime {
  let shuttingDown = false;

  async function shutdown(reason: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${reason} alindi; REST_OTM ${runtimeMode} servisi guvenli kapatiliyor.`);

    const forceTimer = setTimeout(() => {
      logger.error('Guvenli kapanma zaman asimina ugradi.');
      process.exit(1);
    }, 10_000);
    forceTimer.unref?.();

    try {
      await lifecycle.stop?.();
      await closeHttpServer(httpServer);
      await prisma.$disconnect();
      clearTimeout(forceTimer);
      logger.success(`REST_OTM ${runtimeMode} servisi guvenli sekilde kapatildi.`);
    } catch (error) {
      clearTimeout(forceTimer);
      logger.error('Guvenli kapanma hatasi:', error);
      process.exitCode = 1;
    }
  }

  return {
    app,
    httpServer,
    async start() {
      try {
        await lifecycle.beforeStart?.();
        await listen(httpServer);
        await lifecycle.afterStart?.();
        logger.info(`CORS Allowed Origins: ${sharedEnv.CORS_ORIGIN.join(', ')}`);
        logger.success(
          `REST_OTM ${runtimeMode} API http://${sharedEnv.BIND_HOST}:${sharedEnv.PORT}` +
            (lifecycle.websocket ? ' (WebSocket etkin)' : ''),
        );
      } catch (error) {
        await shutdown('STARTUP_FAILURE');
        throw error;
      }
    },
    shutdown,
  };
}

export function installProcessLifecycle(runtime: ApiRuntime): void {
  process.once('SIGTERM', () => void runtime.shutdown('SIGTERM'));
  process.once('SIGINT', () => void runtime.shutdown('SIGINT'));
}
