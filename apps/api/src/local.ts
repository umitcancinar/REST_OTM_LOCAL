// Customer-machine entrypoint. Environment is pinned before importing the
// local graph; cloud signing, license-admin and public projection are not
// reachable dependencies of this file.
process.env.NODE_ENV = 'production';
process.env.RUNTIME_MODE = 'local';

void import('./runtime/local.runtime')
  .then(async ({ createLocalRuntime }) => {
    const { installProcessLifecycle } = await import('./runtime/base.runtime');
    const runtime = createLocalRuntime();
    installProcessLifecycle(runtime);
    await runtime.start();
  })
  .catch((error: unknown) => {
    console.error('REST_OTM local baslatilamadi:', error);
    process.exitCode = 1;
  });
