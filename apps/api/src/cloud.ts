// Render control plane entrypoint. Environment is pinned before importing the
// cloud graph; local routes, sockets, backup and license verification are not
// reachable dependencies of this file.
process.env.NODE_ENV = 'production';
process.env.RUNTIME_MODE = 'cloud';

void import('./runtime/cloud.runtime')
  .then(async ({ createCloudRuntime }) => {
    const { installProcessLifecycle } = await import('./runtime/base.runtime');
    const runtime = createCloudRuntime();
    installProcessLifecycle(runtime);
    await runtime.start();
  })
  .catch((error: unknown) => {
    console.error('REST_OTM cloud baslatilamadi:', error);
    process.exitCode = 1;
  });
