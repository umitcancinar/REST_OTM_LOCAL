import { Application } from 'express';
import { Server as HttpServer } from 'http';
import { authMiddleware } from '../middlewares/auth.middleware';
import { rbac } from '../middlewares/rbac.middleware';
import authRoutes from '../modules/auth/auth.routes';
import cmsRoutes from '../modules/cms/cms.routes';
import customerRoutes from '../modules/customers/customer.routes';
import inventoryRoutes from '../modules/inventory/inventory.routes';
import {
  createLocalBackupRouter,
  LOCAL_BACKUP_RECOVERY_RULES,
  LocalBackupRuntime,
  postgresConnectionFromUrl,
} from '../modules/local-backup';
import {
  createLocalLicenseGate,
  createLocalLicenseRouter,
  LocalLicenseRuntime,
} from '../modules/local-license';
import menuRoutes from '../modules/menu/menu.routes';
import { initCleanupTask } from '../modules/orders/cleanup.task';
import orderRoutes from '../modules/orders/order.routes';
import posRoutes from '../modules/pos/pos.routes';
import printRoutes from '../modules/printing/print.routes';
import localPublicRoutes from '../modules/public/local-public.routes';
import reportRoutes from '../modules/reports/report.routes';
import reservationRoutes from '../modules/reservations/reservation.routes';
import staffRoutes from '../modules/staff/staff.routes';
import tableRoutes from '../modules/tables/table.routes';
import waiterRoutes from '../modules/waiter/waiter.routes';
import { initializeSocketServer } from '../websocket/socket.server';
import { localEnv } from '../config/env.local';
import { RuntimeLifecycle } from './base.runtime';

export function registerLocalProfile(
  app: Application,
  httpServer: HttpServer,
  options: { includeAuth?: boolean; managedServices?: boolean } = {},
): RuntimeLifecycle {
  const managedServices = options.managedServices !== false;
  const localLicenseRuntime = managedServices
    ? new LocalLicenseRuntime({
        runtimeMode: 'local',
        dataDir: localEnv.LOCAL_LICENSE_DATA_DIR,
        serverUrl: localEnv.LOCAL_LICENSE_SERVER_URL,
        publicKeyPem: localEnv.LOCAL_LICENSE_PUBLIC_KEY,
        appVersion: localEnv.APP_VERSION,
        heartbeatIntervalMs: localEnv.LOCAL_LICENSE_HEARTBEAT_MS,
        retryIntervalMs: localEnv.LOCAL_LICENSE_RETRY_MS,
      })
    : undefined;
  const localBackupRuntime = managedServices
    ? new LocalBackupRuntime({
        dataDir: localEnv.LOCAL_POSTGRES_DATA_DIR,
        backupDir: localEnv.LOCAL_BACKUP_DIR,
        pgDumpPath: localEnv.PG_DUMP_PATH,
        connection: postgresConnectionFromUrl(localEnv.DATABASE_URL),
        retention: {
          daily: localEnv.BACKUP_RETENTION_DAILY,
          weekly: localEnv.BACKUP_RETENTION_WEEKLY,
          monthly: localEnv.BACKUP_RETENTION_MONTHLY,
        },
      })
    : undefined;

  if (localLicenseRuntime) {
    app.use('/api/local-license', createLocalLicenseRouter(localLicenseRuntime));
    app.use(createLocalLicenseGate(localLicenseRuntime, {
      additionalRecoveryRules: [
        ...LOCAL_BACKUP_RECOVERY_RULES,
        { path: '/api/auth/login', methods: ['POST'] },
        { path: '/api/auth/refresh', methods: ['POST'] },
        { path: '/api/auth/logout', methods: ['POST'] },
      ],
    }));
  }

  if (options.includeAuth !== false) app.use('/api/auth', authRoutes);
  app.use('/api/public', localPublicRoutes);
  if (localBackupRuntime) {
    app.use('/api/backup', createLocalBackupRouter(localBackupRuntime, [
      authMiddleware,
      rbac('OWNER'),
    ]));
  }
  app.use('/api/menu', menuRoutes);
  app.use('/api/tables', tableRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/printers', printRoutes);
  app.use('/api/reservations', reservationRoutes);
  app.use('/api/waiter', waiterRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/cms', cmsRoutes);
  app.use('/api/pos', posRoutes);
  app.use('/api/staff', staffRoutes);

  const socketServer = initializeSocketServer(httpServer, {
    assertOperationalLicense: localLicenseRuntime
      ? () => localLicenseRuntime.assertOperationalLicense('websocket')
      : undefined,
  });
  const stopCleanupTask = initCleanupTask(
    localLicenseRuntime
      ? () => localLicenseRuntime.assertOperationalLicense('job')
      : undefined,
  );
  const unsubscribeLicenseStatus = localLicenseRuntime?.subscribe((event) => {
    socketServer.emit('local-license:status', event.view);
    if (!event.view.operational) socketServer.disconnectSockets(true);
  });

  return {
    websocket: true,
    beforeStart: () => localBackupRuntime?.initialize(),
    afterStart: () => {
      localLicenseRuntime?.start();
      localBackupRuntime?.startScheduler();
    },
    async stop() {
      stopCleanupTask();
      unsubscribeLicenseStatus?.();
      localLicenseRuntime?.stop();
      localBackupRuntime?.stopScheduler();
      await new Promise<void>((resolve) => socketServer.close(() => resolve()));
    },
  };
}
