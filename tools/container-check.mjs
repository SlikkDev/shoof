// Isolated fictional container check. No deployment, email or real authenticator.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { fixture } from './runtime-fixtures.mjs';
import { fakeAuthenticator } from './passkey-fixtures.mjs';
import { createAuth } from '../src/auth.mjs';
const run=args=>execFileSync('docker',args,{encoding:'utf8'}).trim();
const f=await fixture(), name='shoof-test-'+randomUUID();
const mail=await(await createAuth(f.config)).requestMagic(f.email);
const env={...f.env,REPORTING_TENANT_FILE:'/private-reporting/tenant.json',REPORTING_SNAPSHOT_FILE:'/private-reporting/snapshot.json',REPORTING_OBSERVATIONS_FILE:'/private-reporting/observations.json',REPORTING_SMTP_FILE:'/private-reporting/smtp.json',REPORTING_STATE_DIR:'/private-reporting'};
const common=['--read-only','--user',`${process.getuid()}:${process.getgid()}`,'--mount',`type=bind,src=${f.directory},dst=/private-reporting`,...Object.entries(env).flatMap(([k,v])=>['-e',k+'='+v])];
const script="import {request} from 'node:http';const [path,method,headers,input]=process.argv.slice(1),body=method==='POST'?input:undefined;await new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:8080,path,method,headers:{...JSON.parse(headers),...(body?{'content-length':Buffer.byteLength(body)}:{})}},res=>{let body='';res.on('data',v=>body+=v);res.on('end',()=>{console.log(JSON.stringify({status:res.statusCode,headers:res.headers,body}));resolve();});});req.on('error',reject);req.end(body);});";
const h={host:f.publicHost,origin:'https://'+f.publicHost,'content-type':'application/json','x-shoof-request':'1'};
const send=(path,method='GET',headers=h,body={})=>JSON.parse(run(['exec',name,'node','--input-type=module','-e',script,path,method,JSON.stringify(headers),JSON.stringify(body)]));
let running=false;
try{
 assert.equal(run(['image','inspect','shoof-runtime:check','--format','{{.Config.User}}']),'node');
 run(['run','--rm',...common,'shoof-runtime:check','node','tools/import-report.mjs']);
 run(['run','-d','--name',name,...common,'shoof-runtime:check']);running=true;
 const waitProbe="let status=0;for(let i=0;i<50;i++){try{const r=await fetch('http://127.0.0.1:8080/healthz');status=r.status;if(status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}console.log(status);";
 const healthy=()=>assert.equal(run(['exec',name,'node','--input-type=module','-e',waitProbe]),'200');healthy();
 assert.equal(send('/api/report').status,401);
 const confirmed=send('/api/magic/confirm','POST',h,{token:mail.token});assert.equal(confirmed.status,204);
 const cookie=confirmed.headers['set-cookie'][0].split(';')[0],privateHeaders={...h,cookie};
 const before=JSON.parse(send('/api/report','GET',privateHeaders).body);assert.equal(before.observations[0].metrics[0].total,7);
 const reg=send('/api/passkeys/register/options','POST',privateHeaders),options=JSON.parse(reg.body),flow=reg.headers['set-cookie'][0].split(';')[0],key=fakeAuthenticator();
 assert.equal(send('/api/passkeys/register/verify','POST',{...h,cookie:cookie+'; '+flow},{ceremonyId:options.ceremonyId,response:key.registration(options.options)}).status,204);
 run(['restart',name]);healthy();assert.deepEqual(JSON.parse(send('/api/report','GET',privateHeaders).body),before);
 const challenge=send('/api/passkeys/options','POST'),c=JSON.parse(challenge.body),flow2=challenge.headers['set-cookie'][0].split(';')[0];
 const accepted=send('/api/passkeys/verify','POST',{...h,cookie:flow2},{ceremonyId:c.ceremonyId,response:key.authentication(c.options,options.options.user.id)});assert.equal(accepted.status,204);
 assert.equal(send('/api/logout','POST',{...h,cookie:accepted.headers['set-cookie'][0].split(';')[0]}).status,204);
 console.log('Fictional container checks passed: non-root, read-only root, private import, magic-link confirmation, anonymous denial, passkey registration/login, session/passkey/report restart persistence.');
}finally{if(running)run(['rm','-f',name]);await f.cleanup();}
