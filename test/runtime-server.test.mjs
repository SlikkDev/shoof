import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startRuntime } from '../src/runtime-server.mjs';
import { createRuntimeData } from '../src/runtime-data.mjs';
import { createAuth } from '../src/auth.mjs';
import { fixture } from '../tools/runtime-fixtures.mjs';

const send = (server, path, headers = {}, method = 'GET', input) => new Promise((resolve, reject) => {
  const body = input === undefined ? undefined : typeof input === 'string' ? input : JSON.stringify(input);
  const req = request({hostname:'127.0.0.1', port:server.address().port, path, method, headers:{...headers,...(body===undefined?{}:{'Content-Length':Buffer.byteLength(body)})}}, res => {
    let body = ''; res.setEncoding('utf8'); res.on('data', chunk => {body += chunk;}); res.on('end', () => resolve({status:res.statusCode, headers:res.headers, body}));
  }); req.on('error', reject); req.end(body);
});
const close = server => new Promise(resolve => server.close(resolve));
const postHeaders = f => ({host:f.publicHost, origin:'https://'+f.publicHost, 'content-type':'application/json','x-shoof-request':'1'});
async function login(server,f){const result=await send(server,'/api/login',postHeaders(f),'POST',{email:f.email,password:f.password});assert.equal(result.status,204);return {host:f.publicHost,cookie:result.headers['set-cookie'][0].split(';')[0]};}

test('native sign-in protects reports/assets at the origin and reveals no private data on public login routes', async t => {
  const f = await fixture({owner:true}); t.after(f.cleanup);
  await (await createRuntimeData(f.config)).publish(f.snapshot,f.observations);
  const server=await startRuntime(f.config);t.after(()=>close(server));
  const anonymous={host:f.publicHost};
  assert.equal((await send(server,'/',anonymous)).headers.location,'/login');
  for(const path of ['/api/report','/styles.css','/app.mjs']){
    const denied=await send(server,path,anonymous);assert.equal(denied.status,401);assert.equal(denied.headers['x-shoof-session'],undefined);
    assert.equal((await send(server,path,{...anonymous,'cf-access-jwt-assertion':'a.b.c','cf-access-authenticated-user-email':f.email,'x-forwarded-for':'127.0.0.1'})).status,401);
  }
  for(const path of ['/login','/login.css','/login.mjs']){
    const result=await send(server,path,anonymous);assert.equal(result.status,200);assert.equal(result.body.includes(f.tenant.displayName),false);assert.equal(result.body.includes(f.email),false);
  }
  assert.equal((await send(server,'/api/report')).status,421);assert.equal((await send(server,'/healthz')).status,200);
  assert.equal((await send(server,'/healthz',{...anonymous,'x-forwarded-for':'127.0.0.1'})).status,404);
  const headers=await login(server,f),response=await send(server,'/api/report',headers);
  assert.equal(response.status,200);assert.equal(response.headers['x-shoof-session'],'active');assert.equal(JSON.parse(response.body).observations[0].metrics[0].total,7);
  const parallel=await Promise.all(Array.from({length:12},(_,i)=>send(server,['/','/app.mjs','/styles.css'][i%3],headers)));
  assert.ok(parallel.every(result=>result.status===200));
  assert.equal((await send(server,'/api/report',{...headers,cookie:headers.cookie+'x'})).status,401);
  assert.equal(response.headers['cache-control'],'private, no-store');assert.equal(response.body.includes('passwordHash'),false);
  for(const path of ['/api/report?tenantId=other','/tenant.json','/.env','/state/','/src/auth.mjs','/%2e%2e/tenant.json','/api/signup'])assert.equal((await send(server,path,headers)).status,404);
  assert.equal((await send(server,'/api/report',headers,'POST')).status,405);assert.equal((await send(server,'/api/report',headers,'HEAD')).body,'');
});

test('login and logout require exact same-origin AJAX JSON; logout revokes the server session',async t=>{
  const f=await fixture({owner:true});t.after(f.cleanup);const server=await startRuntime(f.config);t.after(()=>close(server));
  const body={email:f.email,password:f.password},valid=postHeaders(f);
  for(const changed of [{origin:undefined},{origin:'null'},{origin:'https://outsider.example.invalid'},{origin:'https://'+f.publicHost+'.evil.invalid'},{'x-shoof-request':undefined},{'content-type':'text/plain'},{'content-type':'application/x-www-form-urlencoded'},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'}]){
    const headers=Object.fromEntries(Object.entries({...valid,...changed}).filter(([,v])=>v!==undefined));
    for(const path of ['/api/login','/api/logout'])assert.equal((await send(server,path,headers,'POST',body)).status,403);
  }
  const preflight=await send(server,'/api/login',valid,'OPTIONS');assert.equal(preflight.status,405);assert.equal(preflight.headers['access-control-allow-origin'],undefined);
  const headers=await login(server,f);
  assert.equal((await send(server,'/api/logout',headers)).status,405);
  assert.equal((await send(server,'/api/logout',{...valid,...headers},'POST',{})).status,204);
  assert.equal((await send(server,'/api/report',headers)).status,401);
});

test('bad credentials are generic, request sizes are bounded, and throttling ignores forged client IPs',async t=>{
  const f=await fixture({owner:true});t.after(f.cleanup);const server=await startRuntime(f.config);t.after(()=>close(server));
  const headers=postHeaders(f);
  for(const input of ['{broken',{},null,{email:f.email,password:f.password,tenantId:'other'},{email:'x'.repeat(2100),password:f.password}])assert.equal((await send(server,'/api/login',headers,'POST',input)).status,400);
  const one=await send(server,'/api/login',headers,'POST',{email:'other@example.invalid',password:f.password});
  const two=await send(server,'/api/login',headers,'POST',{email:f.email,password:'wrong fictional passphrase'});
  assert.equal(one.status,401);assert.equal(one.body,two.body);
  for(let i=0;i<8;i++)assert.equal((await send(server,'/api/login',{...headers,'x-forwarded-for':`192.0.2.${i}`},'POST',{email:`other${i}@example.invalid`,password:f.password})).status,401);
  const limited=await send(server,'/api/login',headers,'POST',{email:f.email,password:f.password});assert.equal(limited.status,429);assert.equal(limited.headers['retry-after'],'900');
});

test('uninitialized owner cannot sign in; sessions and private data survive restart and operator reset revokes them',async t=>{
  const f=await fixture();t.after(f.cleanup);let server=await startRuntime(f.config);t.after(()=>close(server));
  assert.equal((await send(server,'/api/login',postHeaders(f),'POST',{email:f.email,password:f.password})).status,503);
  await (await createAuth(f.config)).setup(f.email,f.password);
  const headers=await login(server,f);
  const empty=await send(server,'/api/report',headers);assert.equal(empty.status,503);assert.equal(empty.headers['x-shoof-session'],'active');
  await (await createRuntimeData(f.config)).publish(f.snapshot,f.observations);
  const before=JSON.parse((await send(server,'/api/report',headers)).body);
  await close(server);server=await startRuntime(f.config);
  assert.deepEqual(JSON.parse((await send(server,'/api/report',headers)).body),before);
  await (await createAuth(f.config)).setup(f.email,f.password+' reset',{reset:true});
  assert.equal((await send(server,'/api/report',headers)).status,401);
});

test('a slow login is bounded and parallel requests cannot queue password hashes',{timeout:8000},async t=>{
  const f=await fixture({owner:true});t.after(f.cleanup);const server=await startRuntime(f.config);t.after(()=>close(server));
  const stalled=request({hostname:'127.0.0.1',port:server.address().port,path:'/api/login',method:'POST',headers:{...postHeaders(f),'Content-Length':'100'}});
  const closed=new Promise(resolve=>{stalled.on('error',()=>{});stalled.on('close',resolve);});
  const seen=new Promise(resolve=>server.once('request',resolve));
  stalled.write('{');await seen;
  const parallel=await send(server,'/api/login',postHeaders(f),'POST',{email:f.email,password:f.password});
  assert.equal(parallel.status,429);
  await closed;
  assert.equal((await send(server,'/api/login',postHeaders(f),'POST',{email:f.email,password:f.password})).status,204);
});
