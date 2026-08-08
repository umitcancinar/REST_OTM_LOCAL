import {
  ApiRuntime,
  createBaseRuntime,
  createRuntimeController,
  finalizeApi,
} from './base.runtime';
import { registerCloudProfile } from './cloud.profile';

export function createCloudRuntime(): ApiRuntime {
  const { app, httpServer } = createBaseRuntime('cloud');
  const lifecycle = registerCloudProfile(app);
  finalizeApi(app);
  return createRuntimeController('cloud', app, httpServer, lifecycle);
}
