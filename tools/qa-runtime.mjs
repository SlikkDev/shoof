// Manual browser QA: an ephemeral loopback gateway simulates an authenticated
// edge for wholly fictional data. Neither this gateway nor fixture keys ship.
import { createServer, request } from 'node:http';
import { fixture } from './runtime-fixtures.mjs';
import { startRuntime } from '../src/runtime-server.mjs';
import { createRuntimeData } from '../src/runtime-data.mjs';
const f = await fixture();
const data = await createRuntimeData(f.config);
await data.publish(f.snapshot, f.observations);
const backend = await startRuntime(f.config, {keySet: f.keySet});
const gateway = createServer(async (incoming, outgoing) => {
  const token = await f.sign();
  const upstream = request({hostname:'127.0.0.1', port:backend.address().port, method:incoming.method, path:incoming.url, headers:{host:f.access.publicHost, 'cf-access-jwt-assertion':token}}, response => {
    outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing);
  });
  upstream.on('error', () => {outgoing.writeHead(502);outgoing.end();}); incoming.pipe(upstream);
});
await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
console.log(`Fictional runtime QA: http://127.0.0.1:${gateway.address().port}`);
console.log('Temporary signed fixture identity; no external identity provider or source connection.');
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => {
  await new Promise(resolve => gateway.close(resolve));
  await new Promise(resolve => backend.close(resolve));
  await f.cleanup();
});
