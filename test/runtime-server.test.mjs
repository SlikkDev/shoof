import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startRuntime } from '../src/runtime-server.mjs';
import { createRuntimeData } from '../src/runtime-data.mjs';
import { fixture } from '../tools/runtime-fixtures.mjs';
import { fakeAuthenticator } from '../tools/passkey-fixtures.mjs';
const send=(server,path,headers={},method='GET',input)=>new Promise((resolve,reject)=>{const body=input===undefined?undefined:typeof input==='string'?input:JSON.stringify(input);const req=request({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{...headers,...(body===undefined?{}:{'Content-Length':Buffer.byteLength(body)})}},res=>{let body='';res.setEncoding('utf8');res.on('data',part=>body+=part);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.end(body);});
const close=server=>new Promise(resolve=>server.close(resolve));
const postHeaders=f=>({host:f.publicHost,origin:'https://'+f.publicHost,'content-type':'application/json','x-shoof-request':'1'});
const capture=()=>{const messages=[];return {messages,mailer:{sendMagic:async message=>{messages.push(message);}}};};
async function login(server,f,box){const sent=await send(server,'/api/magic/request',postHeaders(f),'POST',{email:f.email});assert.equal(sent.status,202);assert.equal(sent.headers['set-cookie'],undefined);const mail=box.messages.at(-1);assert.ok(mail);const confirmed=await send(server,'/api/magic/confirm',postHeaders(f),'POST',{token:mail.token});assert.equal(confirmed.status,204);return {host:f.publicHost,cookie:confirmed.headers['set-cookie'][0].split(';')[0]};}

test('generic public login and scanner GETs reveal no tenant data; reports/assets need native sessions',async t=>{
 const f=await fixture();t.after(f.cleanup);const box=capture(),server=await startRuntime(f.config,box);t.after(()=>close(server));await(await createRuntimeData(f.config)).publish(f.snapshot,f.observations);
 const anon={host:f.publicHost};assert.equal((await send(server,'/',anon)).headers.location,'/login');
 for(const path of ['/api/report','/api/session','/styles.css','/app.mjs','/security.mjs']){const r=await send(server,path,{...anon,'cf-access-jwt-assertion':'a.b.c','cf-access-authenticated-user-email':f.email,'x-forwarded-for':'127.0.0.1'});assert.equal(r.status,401);assert.equal(r.headers['x-shoof-session'],undefined);}
 for(const path of ['/login','/login.css','/login.mjs','/webauthn.js']){const r=await send(server,path,anon);assert.equal(r.status,200);assert.equal(r.body.includes(f.email),false);assert.equal(r.body.includes(f.tenant.displayName),false);}
 assert.equal((await send(server,'/api/report')).status,421);assert.equal((await send(server,'/healthz')).status,200);assert.equal((await send(server,'/healthz',anon)).status,404);
 const requested=await send(server,'/api/magic/request',postHeaders(f),'POST',{email:f.email}),mail=box.messages[0];
 assert.equal(requested.body.includes(mail.token),false);assert.equal((await send(server,'/login',anon)).status,200);assert.equal((await send(server,'/api/magic/confirm',anon)).status,405);
 assert.equal(requested.headers['set-cookie'],undefined);
 for(const method of ['GET','HEAD'])assert.equal((await send(server,'/api/magic/confirm',anon,method)).status,405);
 assert.equal((await send(server,'/login',{...anon,purpose:'prefetch'},'HEAD')).status,200);
 const accepted=await send(server,'/api/magic/confirm',{...postHeaders(f),cookie:'__Host-shoof-flow='+'b'.repeat(43)},'POST',{token:mail.token});assert.equal(accepted.status,204);
 assert.equal((await send(server,'/api/magic/confirm',postHeaders(f),'POST',{token:mail.token})).status,403);
 const headers={host:f.publicHost,cookie:accepted.headers['set-cookie'][0].split(';')[0]},r=await send(server,'/api/report',headers);assert.equal(r.status,200);assert.equal(JSON.parse(r.body).observations[0].metrics[0].total,7);assert.equal(r.headers['x-shoof-session'],'active');assert.equal(r.headers['referrer-policy'],'no-referrer');
 const parallel=await Promise.all(Array.from({length:12},(_,i)=>send(server,['/','/app.mjs','/styles.css'][i%3],headers)));assert.ok(parallel.every(v=>v.status===200));
 for(const path of ['/api/report?tenantId=other','/tenant.json','/smtp.json','/.env','/state/','/src/auth.mjs','/%2e%2e/tenant.json','/api/signup','/api/login'])assert.equal((await send(server,path,headers)).status,404);
 assert.equal((await send(server,'/api/report',headers,'POST')).status,405);assert.equal((await send(server,'/api/report',headers,'HEAD')).body,'');
});

test('every auth POST requires exact same-origin JSON and CSRF header; logout revokes the session',async t=>{
 const f=await fixture();t.after(f.cleanup);const box=capture(),server=await startRuntime(f.config,box);t.after(()=>close(server));const valid=postHeaders(f);
 for(const changed of [{origin:undefined},{origin:'null'},{origin:'https://evil.example.invalid'},{'x-shoof-request':undefined},{'content-type':'text/plain'},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'}]){const h=Object.fromEntries(Object.entries({...valid,...changed}).filter(([,v])=>v!==undefined));for(const path of ['/api/magic/request','/api/magic/confirm','/api/passkeys/options','/api/passkeys/verify','/api/passkeys/register/options','/api/passkeys/register/verify','/api/passkeys/revoke','/api/logout'])assert.equal((await send(server,path,h,'POST',{})).status,403);}
 const preflight=await send(server,'/api/magic/request',valid,'OPTIONS');assert.equal(preflight.status,405);assert.equal(preflight.headers['access-control-allow-origin'],undefined);
 const headers=await login(server,f,box);assert.equal((await send(server,'/api/logout',headers)).status,405);assert.equal((await send(server,'/api/logout',{...valid,...headers},'POST',{})).status,204);assert.equal((await send(server,'/api/report',headers)).status,401);
});

test('mail requests never enumerate the owner, expose delivery errors or bypass persisted limits with IP headers',async t=>{
 const f=await fixture();t.after(f.cleanup);const box=capture(),server=await startRuntime(f.config,box);t.after(()=>close(server));const h=postHeaders(f);
 for(const input of ['{broken',{},null,{email:f.email,tenantId:'other'},{email:'x'.repeat(2100)}])assert.equal((await send(server,'/api/magic/request',h,'POST',input)).status,400);
 const other=await send(server,'/api/magic/request',h,'POST',{email:'other@example.invalid'}),owner=await send(server,'/api/magic/request',h,'POST',{email:f.email});assert.equal(other.status,202);assert.equal(other.body,owner.body);assert.equal(box.messages.length,1);
 for(let i=0;i<10;i++)assert.equal((await send(server,'/api/magic/request',{...h,'x-forwarded-for':`192.0.2.${i}`},'POST',{email:'other@example.invalid'})).body,owner.body);
 assert.equal((await send(server,'/api/magic/request',h,'POST',{email:f.email})).status,202);assert.equal(box.messages.length,1);
 const ff=await fixture();t.after(ff.cleanup);let attempts=0;const failing=await startRuntime(ff.config,{mailer:{sendMagic:async()=>{attempts++;throw new Error('Fictional SMTP credential must not appear');}}});t.after(()=>close(failing));assert.equal((await send(failing,'/api/magic/request',postHeaders(ff),'POST',{email:ff.email})).body,owner.body);assert.equal(attempts,1);
});

test('HTTP passkey enrollment/login persists through restart and authenticated removal revokes it',async t=>{
 const f=await fixture();t.after(f.cleanup);const box=capture();let server=await startRuntime(f.config,box);t.after(()=>close(server));const headers=await login(server,f,box),h={...postHeaders(f),...headers};
 const empty=await send(server,'/api/report',headers);assert.equal(empty.status,503);assert.equal(empty.headers['x-shoof-session'],'active');
 const options=await send(server,'/api/passkeys/register/options',h,'POST',{});assert.equal(options.status,200);const c=JSON.parse(options.body),flow=options.headers['set-cookie'][0].split(';')[0],key=fakeAuthenticator();
 const enrolled=await send(server,'/api/passkeys/register/verify',{...h,cookie:headers.cookie+'; '+flow},'POST',{ceremonyId:c.ceremonyId,response:key.registration(c.options)});assert.equal(enrolled.status,204);
 await(await createRuntimeData(f.config)).publish(f.snapshot,f.observations);const before=(await send(server,'/api/report',headers)).body;await close(server);server=await startRuntime(f.config,box);assert.equal((await send(server,'/api/report',headers)).body,before);
 const challenge=await send(server,'/api/passkeys/options',postHeaders(f),'POST',{}),a=JSON.parse(challenge.body),browser=challenge.headers['set-cookie'][0].split(';')[0];
 const signed=await send(server,'/api/passkeys/verify',{...postHeaders(f),cookie:browser},'POST',{ceremonyId:a.ceremonyId,response:key.authentication(a.options,c.options.user.id)});assert.equal(signed.status,204);
 const newer={...postHeaders(f),cookie:signed.headers['set-cookie'][0].split(';')[0]};assert.equal((await send(server,'/api/passkeys/revoke',newer,'POST',{id:key.id})).status,204);assert.equal((await send(server,'/api/report',headers)).status,401);assert.equal((await send(server,'/api/report',newer)).status,401);
});

test('slow authentication bodies have a deadline and cannot queue work',{timeout:8000},async t=>{
 const f=await fixture();t.after(f.cleanup);const box=capture(),server=await startRuntime(f.config,box);t.after(()=>close(server));const stalled=request({hostname:'127.0.0.1',port:server.address().port,path:'/api/magic/request',method:'POST',headers:{...postHeaders(f),'Content-Length':'100'}});
 const closed=new Promise(resolve=>{stalled.on('error',()=>{});stalled.on('close',resolve);}),seen=new Promise(resolve=>server.once('request',resolve));stalled.write('{');await seen;assert.equal((await send(server,'/api/magic/request',postHeaders(f),'POST',{email:f.email})).status,429);await closed;assert.equal((await send(server,'/api/magic/request',postHeaders(f),'POST',{email:f.email})).status,202);
});
