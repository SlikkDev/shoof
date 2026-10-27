import { loadRuntimeConfig, readPrivateJson } from '../src/runtime-config.mjs';
import { createRuntimeData } from '../src/runtime-data.mjs';
try {
  const expected = process.env.REPORTING_EXPECTED_DIGEST;
  if (expected !== 'absent' && !/^[a-f0-9]{64}$/.test(expected ?? '')) throw new Error('Explicit reporting baseline required');
  const config = await loadRuntimeConfig();
  const snapshot = await readPrivateJson(process.env.REPORTING_SNAPSHOT_FILE);
  const observations = process.env.REPORTING_OBSERVATIONS_FILE ? await readPrivateJson(process.env.REPORTING_OBSERVATIONS_FILE) : null;
  const data = await createRuntimeData(config);
  await data.publish(snapshot, observations, {expectedDigest: expected === 'absent' ? null : expected});
  console.log('Private report accepted. No source connection was executed.');
} catch { console.error('Import refused. Previous accepted report was preserved.'); process.exitCode = 1; }
