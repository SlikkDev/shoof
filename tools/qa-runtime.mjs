// Loopback-only passwordless browser QA. Mail is captured locally, never sent.
// The gateway adapts Host/Origin only; it cannot create authentication sessions.
// WebAuthn's real HTTPS RP scope is tested by protocol fixtures, not a local device.
import { createServer, request } from 'node:http';
import { fixture } from './runtime-fixtures.mjs';
import { startRuntime } from '../src/runtime-server.mjs';
import { createRuntimeData } from '../src/runtime-data.mjs';
const f=await fixture();await(await createRuntimeData(f.config)).publish(f.snapshot,f.observations);
const inbox=[];
const backend=await startRuntime(f.config,{mailer:{sendMagic:async({url})=>{inbox.push(url);}}});
const gateway=createServer((incoming,outgoing)=>{
 if(incoming.url==='/qa-inbox'&&incoming.method==='GET'){
  outgoing.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  outgoing.end('<h1>Fictional local inbox</h1><p>No email was sent. These links belong only to this temporary fixture.</p>'+inbox.map((url,i)=>`<p><a href="${url.replace('https://'+f.publicHost,'http://127.0.0.1:'+gateway.address().port)}">Open fictional sign-in email ${i+1}</a></p>`).join(''));return;
 }
 const headers={...incoming.headers,host:f.publicHost};if(headers.origin===`http://127.0.0.1:${gateway.address().port}`)headers.origin='https://'+f.publicHost;
 const upstream=request({hostname:'127.0.0.1',port:backend.address().port,method:incoming.method,path:incoming.url,headers},response=>{outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);});upstream.on('error',()=>{outgoing.writeHead(502);outgoing.end();});incoming.pipe(upstream);
});
await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
console.log(`Fictional passwordless QA: http://127.0.0.1:${gateway.address().port}\nLocal captured inbox: http://127.0.0.1:${gateway.address().port}/qa-inbox\nFictional owner: ${f.email}`);
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await new Promise(resolve=>gateway.close(resolve));await new Promise(resolve=>backend.close(resolve));await f.cleanup();});
