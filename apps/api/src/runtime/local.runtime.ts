import {
  ApiRuntime,
  createBaseRuntime,
  createRuntimeController,
  finalizeApi,
} from './base.runtime';
import { registerLocalProfile } from './local.profile';

export function createLocalRuntime(): ApiRuntime {
  const { app, httpServer } = createBaseRuntime('local');
  const lifecycle = registerLocalProfile(app, httpServer);
  finalizeApi(app);
  return createRuntimeController('local', app, httpServer, lifecycle);
}
