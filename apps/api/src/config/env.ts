// Development-only compatibility facade. Production entrypoints import the
// cloud/local configuration directly so secrets and local settings cannot
// cross the release dependency boundary.
import { cloudEnv } from './env.cloud';
import { localEnv } from './env.local';
import { sharedEnv } from './env.shared';

export type { RuntimeMode } from './env.shared';

export const env = {
  ...sharedEnv,
  ...cloudEnv,
  ...localEnv,
  isCloudRuntime: sharedEnv.RUNTIME_MODE === 'cloud' || sharedEnv.RUNTIME_MODE === 'all',
  isLocalRuntime: sharedEnv.RUNTIME_MODE === 'local' || sharedEnv.RUNTIME_MODE === 'all',
} as const;
