import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAuth, sessionToken, sessionCookie, sessionSeconds } from '../src/auth.mjs';
import { fixture } from '../tools/runtime-fixtures.mjs';

async function authFile(f) { return join(f.directory, (await readdir(f.directory)).find(n => /^[a-f0-9]{64}\.json$/.test(n))); }

test('explicit owner setup stores Argon2id only; no default account or accidental overwrite', async t => {
  const f = await fixture(); t.after(f.cleanup); const auth = await createAuth(f.config);
  assert.deepEqual(await auth.login(f.email, f.password), {status:'unavailable'});
  for (const [email,password] of [['bad',f.password],[f.email,'too short'],[f.email,'x'.repeat(129)]]) await assert.rejects(auth.setup(email,password));
  await auth.setup(f.email, f.password);
  const stored = await readFile(await authFile(f),'utf8');
  assert.equal(stored.includes(f.password),false); assert.match(JSON.parse(stored).passwordHash,/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  await assert.rejects(auth.setup('other@example.invalid',f.password));
  assert.equal(await readFile(await authFile(f),'utf8'),stored);
  assert.deepEqual(await auth.login('other@example.invalid',f.password),{status:'denied'});
  assert.deepEqual(await auth.login(f.email,'wrong fictional passphrase'),{status:'denied'});
  assert.equal((await auth.login(f.email.toUpperCase(),f.password)).status,'accepted');
});

test('opaque sessions survive restart, rotate on login, expire absolutely, and revoke on logout/reset', async t => {
  const f = await fixture(); t.after(f.cleanup); let instant = 1800000000000;
  const auth = await createAuth(f.config,{clock:()=>instant}); await auth.setup(f.email,f.password);
  const first = await auth.login(f.email,f.password);
  assert.equal(await auth.authenticated(first.token),true);
  assert.equal(await (await createAuth(f.config,{clock:()=>instant})).authenticated(first.token),true);
  assert.equal((await readFile(await authFile(f),'utf8')).includes(first.token),false);
  const second = await auth.login(f.email,f.password,first.token);
  assert.notEqual(second.token,first.token); assert.equal(await auth.authenticated(first.token),false);
  await auth.logout(second.token); assert.equal(await auth.authenticated(second.token),false);
  const third = await auth.login(f.email,f.password);
  instant += sessionSeconds * 1000; assert.equal(await auth.authenticated(third.token),false);
  const fourth = await auth.login(f.email,f.password);
  await auth.setup(f.email,f.password+' reset',{reset:true}); assert.equal(await auth.authenticated(fourth.token),false);
  assert.equal((await auth.login(f.email,f.password)).status,'denied');
  assert.equal((await auth.login(f.email,f.password+' reset')).status,'accepted');
});

test('login budget survives restarts and changing usernames; existing sessions remain usable', async t => {
  const f = await fixture(); t.after(f.cleanup); let instant=1800000000000;
  const auth = await createAuth(f.config,{clock:()=>instant}); await auth.setup(f.email,f.password);
  const session = await auth.login(f.email,f.password);
  for(let i=0;i<9;i++)assert.equal((await auth.login(`outsider${i}@example.invalid`,f.password)).status,'denied');
  const restarted = await createAuth(f.config,{clock:()=>instant});
  assert.equal((await restarted.login(f.email,f.password)).status,'limited');
  assert.equal(await restarted.authenticated(session.token),true);
  instant += 15*60*1000;
  assert.equal((await restarted.login(f.email,f.password)).status,'accepted');
});

test('session retention is bounded and corrupt/cross-tenant state fails closed before hashing', async t => {
  const f = await fixture(); t.after(f.cleanup);let instant=1800000000000;
  const auth=await createAuth(f.config,{clock:()=>instant});await auth.setup(f.email,f.password);
  const first=await auth.login(f.email,f.password);
  for(let i=0;i<10;i++){instant+=16*60*1000;await auth.login(f.email,f.password);}
  assert.equal(await auth.authenticated(first.token),false);
  const file=await authFile(f),state=JSON.parse(await readFile(file));assert.equal(state.sessions.length,10);
  const original=await readFile(file);
  for(const change of [s=>s.workspaceId='other-fictional',s=>s.passwordHash=s.passwordHash.replace('m=19456','m=4294967295'),s=>s.sessions.push(s.sessions[0])]){
    const broken=structuredClone(state);change(broken);await writeFile(file,JSON.stringify(broken));
    await assert.rejects(auth.login(f.email,f.password));await assert.rejects(auth.authenticated(first.token));
    await writeFile(file,original);
  }
  const other=await createAuth({...f.config,tenant:{...f.tenant,tenantId:'other-fictional'}});
  assert.equal(await other.authenticated(first.token),false);
});

test('cookie policy is host-only, secure, HTTP-only; ambiguous and forged cookies are rejected',()=>{
  const token='a'.repeat(43),cookie=sessionCookie(token);
  for(const part of ['__Host-shoof=','Path=/','HttpOnly','Secure','SameSite=Strict','Max-Age=28800'])assert.ok(cookie.includes(part));
  assert.equal(cookie.includes('Domain='),false);
  assert.equal(sessionToken(`other=value; __Host-shoof=${token}`),token);
  for(const header of [undefined,'', '__Host-shoof=forged',`__Host-shoof=${token}; __Host-shoof=${token}`])assert.equal(sessionToken(header),null);
  assert.match(sessionCookie('',true),/Max-Age=0/);
});

test('owner setup CLI refuses noninteractive credential input without changing state', async t=>{
  const f=await fixture();t.after(f.cleanup);
  const before=await readdir(f.directory);
  const result=spawnSync(process.execPath,[new URL('../tools/auth-setup.mjs',import.meta.url).pathname],{env:{...process.env,...f.env},input:'fictional input',encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/Owner setup refused/);assert.deepEqual(await readdir(f.directory),before);
});
