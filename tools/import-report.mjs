import { loadRuntimeConfig, readPrivateJson } from '../src/runtime-config.mjs';
import { createRuntimeData } from '../src/runtime-data.mjs';
try {
  const config = await loadRuntimeConfig();
  const snapshot = await readPrivateJson(process.env.REPORTING_SNAPSHOT_FILE);
  const observations = process.env.REPORTING_OBSERVATIONS_FILE ? await readPrivateJson(process.env.REPORTING_OBSERVATIONS_FILE) : null;
  const data = await createRuntimeData(config);
  await data.publish(snapshot, observations);
  console.log('Private report accepted. No source connection was executed.');
} catch { console.error('Import refused. Previous accepted report was preserved.'); process.exitCode = 1; }
