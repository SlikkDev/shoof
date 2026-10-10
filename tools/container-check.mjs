// Isolated fictional container smoke test. Never touches a running deployment.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { fixture } from './runtime-fixtures.mjs';
const run = args => execFileSync('docker', args, {encoding: 'utf8'}).trim();
const f = await fixture({owner:true}), name = 'shoof-test-' + randomUUID();
const env = {...f.env, REPORTING_TENANT_FILE: '/private-reporting/tenant.json', REPORTING_SNAPSHOT_FILE: '/private-reporting/snapshot.json', REPORTING_OBSERVATIONS_FILE: '/private-reporting/observations.json', REPORTING_STATE_DIR: '/private-reporting'};
const common = ['--read-only', '--user', `${process.getuid()}:${process.getgid()}`, '--mount', `type=bind,src=${f.directory},dst=/private-reporting`, ...Object.entries(env).flatMap(([k,v]) => ['-e', k + '=' + v])];
let running = false;
try {
  assert.equal(run(['image', 'inspect', 'shoof-runtime:check', '--format', '{{.Config.User}}']), 'node');
  run(['run', '--rm', ...common, 'shoof-runtime:check', 'node', 'tools/import-report.mjs']);
  const read = ['run', '--rm', ...common, 'shoof-runtime:check', 'node', '--input-type=module', '-e', "import {loadRuntimeConfig} from './src/runtime-config.mjs'; import {createRuntimeData} from './src/runtime-data.mjs'; const d=await createRuntimeData(await loadRuntimeConfig()); console.log(JSON.stringify(await d.read()));"];
  const before = JSON.parse(run(read));
  assert.equal(before.observations[0].metrics[0].total, 7);
  run(['run', '-d', '--name', name, ...common, 'shoof-runtime:check']); running = true;
  const waitProbe = "let status=0; for(let i=0;i<50;i++){try{const r=await fetch('http://127.0.0.1:8080/healthz');status=r.status;if(status===200)break;}catch{} await new Promise(r=>setTimeout(r,100));} console.log(status);";
  assert.equal(run(['exec', name, 'node', '--input-type=module', '-e', waitProbe]), '200');
  // Use node:http for an explicit origin Host; fetch controls the Host header.
  const anonymous = "import {get} from 'node:http'; await new Promise((resolve,reject)=>{const r=get({hostname:'127.0.0.1',port:8080,path:'/api/report',headers:{host:'report.example.invalid'}},res=>{console.log(res.statusCode);res.resume();res.on('end',resolve);});r.on('error',reject);});";
  assert.equal(run(['exec', name, 'node', '--input-type=module', '-e', anonymous]), '401');
  const login = "import {request} from 'node:http'; const [email,password]=process.argv.slice(1); const body=JSON.stringify({email,password}); await new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:8080,path:'/api/login',method:'POST',headers:{host:'report.example.invalid',origin:'https://report.example.invalid','content-type':'application/json','x-shoof-request':'1','content-length':Buffer.byteLength(body)}},res=>{if(res.statusCode!==204)return reject(new Error('Fictional login failed'));console.log(res.headers['set-cookie'][0].split(';')[0]);res.resume();res.on('end',resolve);});req.on('error',reject);req.end(body);});";
  const cookie = run(['exec', name, 'node', '--input-type=module', '-e', login, f.email, f.password]);
  const authenticated = "import {get} from 'node:http'; await new Promise((resolve,reject)=>{const req=get({hostname:'127.0.0.1',port:8080,path:'/api/report',headers:{host:'report.example.invalid',cookie:process.argv[1]}},res=>{let body='';res.on('data',part=>body+=part);res.on('end',()=>{if(res.statusCode!==200)return reject(new Error('Session rejected'));console.log(body);resolve();});});req.on('error',reject);});";
  assert.deepEqual(JSON.parse(run(['exec', name, 'node', '--input-type=module', '-e', authenticated, cookie])), before);
  run(['restart', name]);
  assert.equal(run(['exec', name, 'node', '--input-type=module', '-e', waitProbe]), '200');
  assert.deepEqual(JSON.parse(run(read)), before);
  assert.deepEqual(JSON.parse(run(['exec', name, 'node', '--input-type=module', '-e', authenticated, cookie])), before);
  console.log('Fictional container checks passed: non-root image, read-only root, private mounted import, native sign-in, anonymous denial, session and report restart persistence.');
} finally { if (running) run(['rm', '-f', name]); await f.cleanup(); }
