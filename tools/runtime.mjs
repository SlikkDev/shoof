import { loadRuntimeConfig } from '../src/runtime-config.mjs';
import { startRuntime } from '../src/runtime-server.mjs';
try {
  const server = await startRuntime(await loadRuntimeConfig());
  console.log('Protected reporting runtime ready.');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close(() => process.exit(0)));
} catch { console.error('Runtime refused to start. Check protected external configuration.'); process.exitCode = 1; }
