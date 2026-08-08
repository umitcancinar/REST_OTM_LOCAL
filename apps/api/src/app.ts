// Development-only combined entrypoint. Production releases must start
// cloud.ts or local.ts so the dependency graphs remain physically isolated.
process.env.RUNTIME_MODE = 'all';

void import('./runtime/development.runtime')
  .then(async ({ createDevelopmentRuntime }) => {
    const { installProcessLifecycle } = await import('./runtime/base.runtime');
    const runtime = createDevelopmentRuntime();
    installProcessLifecycle(runtime);
    await runtime.start();
  })
  .catch((error: unknown) => {
    console.error('REST_OTM development runtime baslatilamadi:', error);
    process.exitCode = 1;
  });
