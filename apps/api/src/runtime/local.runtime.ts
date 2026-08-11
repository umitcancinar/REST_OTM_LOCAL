import {
  ApiRuntime,
  createBaseRuntime,
  createRuntimeController,
  finalizeApi,
} from './base.runtime';
import { registerLocalProfile } from './local.profile';
import { localEnv } from '../config/env.local';
import { timingSafeEqual } from 'crypto';

function safeTokenMatch(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createLocalRuntime(): ApiRuntime {
  const { app, httpServer } = createBaseRuntime('local');
  const lifecycle = registerLocalProfile(app, httpServer);

  // Yalniz native Windows supervisor bu rotayi kullanir. Token her kurulumda
  // ayri uretilir, DPAPI secret store'da tutulur ve ag uzerine acilmaz.
  app.post('/internal/runtime/shutdown', (req, res) => {
    const remote = req.socket.remoteAddress;
    const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    const authorization = req.get('authorization') ?? '';
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!isLoopback || !supplied || !safeTokenMatch(supplied, localEnv.INTERNAL_RUNTIME_TOKEN)) {
      res.status(404).end();
      return;
    }
    res.status(202).end();
    setImmediate(() => void runtime.shutdown('SUPERVISOR_HTTP'));
  });
  finalizeApi(app);
  const runtime = createRuntimeController('local', app, httpServer, lifecycle);
  return runtime;
}
