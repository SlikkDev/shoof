// Loopback-only native-login browser QA with ephemeral fictional owner/data.
// The gateway adapts a localhost Origin/Host; it never authenticates requests.
// This helper and fixture inputs are excluded from the production image.
import { createServer, request } from 'node:http';
import { fixture } from './runtime-fixtures.mjs';
import { startRuntime } from '../src/runtime-server.mjs';
import { createRuntimeData } from '../src/runtime-data.mjs';
const f = await fixture({owner:true});
await (await createRuntimeData(f.config)).publish(f.snapshot,f.observations);
const backend=await startRuntime(f.config);
const gateway=createServer((incoming,outgoing)=>{
  const headers={...incoming.headers,host:f.publicHost};
  if(headers.origin===`http://127.0.0.1:${gateway.address().port}`)headers.origin='https://'+f.publicHost;
  const upstream=request({hostname:'127.0.0.1',port:backend.address().port,method:incoming.method,path:incoming.url,headers},response=>{
    outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);
  });upstream.on('error',()=>{outgoing.writeHead(502);outgoing.end();});incoming.pipe(upstream);
});
await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
console.log(`Fictional login QA: http://127.0.0.1:${gateway.address().port}`);
console.log(`Ephemeral fictional owner: ${f.email}\nEphemeral fictional password: ${f.password}`);
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{
  await new Promise(resolve=>gateway.close(resolve));await new Promise(resolve=>backend.close(resolve));await f.cleanup();
});
