// Loopback-only passwordless browser QA. Mail is captured locally, never sent.
// The gateway adapts Host/Origin only; it cannot create authentication sessions.
// WebAuthn's real HTTPS RP scope is tested by protocol fixtures, not a local device.
import { createServer, request } from 'node:http';
import { fixture } from './runtime-fixtures.mjs';
import { startRuntime } from '../src/runtime-server.mjs';
import { createRuntimeData } from '../src/runtime-data.mjs';
const f=await fixture();await(await createRuntimeData(f.config)).publish(f.snapshot,f.observations);
const inbox=[];
let holdNext=false, releaseHeld=null, heldStatus='No response held.', reportStatus='No report read yet.';
const backend=await startRuntime(f.config,{mailer:{sendMagic:async({url})=>{inbox.push(url);}}});
const gateway=createServer((incoming,outgoing)=>{
 if(incoming.method==='POST'&&['/qa-hold','/qa-release'].includes(incoming.url)){
  if(incoming.url==='/qa-hold'&&!releaseHeld){holdNext=true;heldStatus='Next confirmation response will be held.';}
  if(incoming.url==='/qa-release'){holdNext=false;releaseHeld?.();}
  outgoing.writeHead(303,{'Location':'/qa-inbox'});outgoing.end();return;
 }
 if(incoming.url==='/qa-inbox'&&incoming.method==='GET'){
  outgoing.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  outgoing.end('<h1>Fictional local inbox</h1><p>No email was sent. These links belong only to this temporary fixture.</p>'+inbox.map((url,i)=>`<p><a href="${url.replace('https://'+f.publicHost,'http://127.0.0.1:'+gateway.address().port)}">Open fictional sign-in email ${i+1}</a></p>`).join('')+
   '<h2>Delayed confirmation regression</h2><form method="post" action="/qa-hold"><button>Hold next confirmation</button></form><form method="post" action="/qa-release"><button>Release held response</button></form><p>'+heldStatus+'</p><p>'+reportStatus+'</p>');return;
 }
 const headers={...incoming.headers,host:f.publicHost};if(headers.origin===`http://127.0.0.1:${gateway.address().port}`)headers.origin='https://'+f.publicHost;
 const delay=incoming.url==='/api/magic/confirm'&&holdNext;
 if(delay)holdNext=false;
 const upstream=request({hostname:'127.0.0.1',port:backend.address().port,method:incoming.method,path:incoming.url,headers},response=>{
  if(incoming.url==='/api/report'){
   const cookie=incoming.headers.cookie||'';
   reportStatus=`Report response: ${response.statusCode}; session cookie present: ${/(?:^|; )__Host-shoof=/.test(cookie)}; flow cookie present: ${/(?:^|; )__Host-shoof-flow=/.test(cookie)}.`;
  }
  if(!delay){outgoing.writeHead(response.statusCode,response.headers);response.pipe(outgoing);return;}
  // Hold actual backend bytes and headers after its commit. Releasing delivers
  // the real Set-Cookie effects to the browser; no session is fabricated here.
  const parts=[];response.on('data',part=>parts.push(part));response.on('end',()=>{
   const cookies=response.headers['set-cookie']||[];
   heldStatus=`Held response: ${response.statusCode}; session cookie issued: ${cookies.some(c=>c.startsWith('__Host-shoof='))}; flow cookie cleared: ${cookies.some(c=>c.startsWith('__Host-shoof-flow=')&&c.includes('Max-Age=0'))}.`;
   releaseHeld=()=>{releaseHeld=null;heldStatus='Released. '+heldStatus;outgoing.writeHead(response.statusCode,response.headers);outgoing.end(Buffer.concat(parts));};
  });
 });upstream.on('error',()=>{outgoing.writeHead(502);outgoing.end();});incoming.pipe(upstream);
});
await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
console.log(`Fictional passwordless QA: http://127.0.0.1:${gateway.address().port}\nLocal captured inbox: http://127.0.0.1:${gateway.address().port}/qa-inbox\nFictional owner: ${f.email}`);
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{releaseHeld?.();await new Promise(resolve=>gateway.close(resolve));await new Promise(resolve=>backend.close(resolve));await f.cleanup();});
