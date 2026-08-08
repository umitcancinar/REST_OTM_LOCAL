import {
  ApiRuntime,
  createBaseRuntime,
  createRuntimeController,
  finalizeApi,
  RuntimeLifecycle,
} from './base.runtime';
import { registerCloudProfile } from './cloud.profile';
import { registerLocalProfile } from './local.profile';

export function createDevelopmentRuntime(): ApiRuntime {
  const { app, httpServer } = createBaseRuntime('all');
  const cloud = registerCloudProfile(app);
  const local = registerLocalProfile(app, httpServer, {
    includeAuth: false,
    managedServices: false,
  });
  finalizeApi(app);

  const lifecycle: RuntimeLifecycle = {
    websocket: true,
    async beforeStart() {
      await cloud.beforeStart?.();
      await local.beforeStart?.();
    },
    async afterStart() {
      await cloud.afterStart?.();
      await local.afterStart?.();
    },
    async stop() {
      await local.stop?.();
      await cloud.stop?.();
    },
  };
  return createRuntimeController('all', app, httpServer, lifecycle);
}
