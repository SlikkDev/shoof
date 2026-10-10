import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createAuth, sessionToken, sessionCookie, sessionSeconds, newToken } from '../src/auth.mjs';
import { fixture } from '../tools/runtime-fixtures.mjs';
import { fakeAuthenticator } from '../tools/passkey-fixtures.mjs';
const authFile = async f => join(f.directory, (await readdir(f.directory)).find(n => /^[a-f0-9]{64}\.json$/.test(n)));
async function signIn(auth,f,browser=newToken()){const mail=await auth.requestMagic(f.email,browser);assert.ok(mail);const result=await auth.redeemMagic(mail.token,browser);assert.equal(result.status,'accepted');return result.token;}
async function enroll(auth,token,browser=newToken(),key=fakeAuthenticator()){const c=await auth.options('register',browser,token);assert.equal(c.status,'accepted');assert.equal((await auth.verify('register',c.ceremonyId,key.registration(c.options),browser,token)).status,'accepted');return {key,userId:c.options.user.id};}

test('magic links are scoped, browser-bound, expiring, hashed and single use; unknown email gets no delivery',async t=>{
  const f=await fixture();t.after(f.cleanup);let instant=1800000000000;const auth=await createAuth(f.config,{clock:()=>instant}),browser=newToken();
  assert.equal(await auth.requestMagic('other@example.invalid',browser),null);
  const mail=await auth.requestMagic(f.email.toUpperCase(),browser);assert.equal(mail.to,f.email);assert.equal(new URL(mail.url).origin,'https://'+f.publicHost);assert.equal(new URL(mail.url).search,'');
  const state=await readFile(await authFile(f),'utf8');assert.equal(state.includes(mail.token),false);assert.equal(state.includes(browser),false);
  assert.equal((await auth.redeemMagic(mail.token,newToken())).status,'denied');
  const first=await auth.redeemMagic(mail.token,browser);assert.equal(first.status,'accepted');assert.equal((await auth.redeemMagic(mail.token,browser)).status,'denied');
  const second=await auth.requestMagic(f.email,browser);instant+=600000;assert.equal((await auth.redeemMagic(second.token,browser)).status,'denied');
  const third=await auth.requestMagic(f.email,browser);await auth.cancelMagic(third.token);assert.equal((await auth.redeemMagic(third.token,browser)).status,'denied');
});

test('session rotation, restart, absolute expiry and logout preserve opaque server-side boundaries',async t=>{
  const f=await fixture();t.after(f.cleanup);let instant=1800000000000;const auth=await createAuth(f.config,{clock:()=>instant}),browser=newToken();
  const first=await signIn(auth,f,browser);const mail=await auth.requestMagic(f.email,browser),second=await auth.redeemMagic(mail.token,browser,first);
  assert.equal(await auth.authenticated(first),false);assert.equal(await (await createAuth(f.config,{clock:()=>instant})).authenticated(second.token),true);
  assert.equal((await readFile(await authFile(f),'utf8')).includes(second.token),false);
  instant+=sessionSeconds*1000;assert.equal(await auth.authenticated(second.token),false);
  const third=await signIn(auth,f);await auth.logout(third);assert.equal(await auth.authenticated(third),false);
});

test('magic request budget is persistent and shared across addresses; existing sessions still work',async t=>{
  const f=await fixture();t.after(f.cleanup);let instant=1800000000000;const auth=await createAuth(f.config,{clock:()=>instant});const token=await signIn(auth,f);
  for(let i=0;i<9;i++)assert.equal(await auth.requestMagic(`other${i}@example.invalid`,newToken()),null);
  const restart=await createAuth(f.config,{clock:()=>instant});assert.equal(await restart.requestMagic(f.email,newToken()),null);assert.equal(await restart.authenticated(token),true);
  instant+=900000;assert.ok(await restart.requestMagic(f.email,newToken()));
});

test('passkey registration and login verify real signatures, user handle, counter, scope and replay',async t=>{
  const f=await fixture();t.after(f.cleanup);const auth=await createAuth(f.config),token=await signIn(auth,f),browser=newToken();const {key,userId}=await enroll(auth,token,browser);
  const c=await auth.options('authenticate',browser);assert.equal(c.options.allowCredentials,undefined);assert.equal(c.options.userVerification,'required');
  const response=key.authentication(c.options,userId),result=await auth.verify('authenticate',c.ceremonyId,response,browser);
  assert.equal(result.status,'accepted');assert.equal(await auth.authenticated(result.token),true);assert.equal((await auth.verify('authenticate',c.ceremonyId,response,browser)).status,'denied');
  const next=await auth.options('authenticate',browser);assert.equal((await auth.verify('authenticate',next.ceremonyId,key.authentication(next.options,userId,{counter:1}),browser)).status,'denied');
  const fresh=await auth.options('authenticate',browser);assert.equal((await auth.verify('authenticate',fresh.ceremonyId,key.authentication(fresh.options,userId,{counter:2}),browser)).status,'accepted');
});

for(const [name,change] of Object.entries({origin:{origin:'https://evil.example.invalid'},rp:{rpID:'evil.example.invalid'},uv:{flags:1},challenge:{challenge:newToken()},crossOrigin:{crossOrigin:true},crossOriginType:{crossOrigin:'false'}}))test(`passkey ${name} mismatch is denied and consumes the bound challenge`,async t=>{
  const f=await fixture();t.after(f.cleanup);const auth=await createAuth(f.config),token=await signIn(auth,f),browser=newToken(),key=fakeAuthenticator();
  const reg=await auth.options('register',browser,token);assert.equal((await auth.verify('register',reg.ceremonyId,key.registration(reg.options,change),browser,token)).status,'denied');
  assert.equal((await auth.verify('register',reg.ceremonyId,key.registration(reg.options),browser,token)).status,'denied');
  const enrolled=await enroll(auth,token,browser,key),c=await auth.options('authenticate',browser);
  assert.equal((await auth.verify('authenticate',c.ceremonyId,key.authentication(c.options,enrolled.userId,change),browser)).status,'denied');
  assert.equal((await auth.verify('authenticate',c.ceremonyId,key.authentication(c.options,enrolled.userId),browser)).status,'denied');
});

test('enrollment needs the same fresh session; challenges expire and sign-out invalidates enrollment',async t=>{
  const f=await fixture();t.after(f.cleanup);let instant=1800000000000;const auth=await createAuth(f.config,{clock:()=>instant}),browser=newToken(),key=fakeAuthenticator();
  assert.equal((await auth.options('register',browser)).status,'denied');const token=await signIn(auth,f),other=await signIn(auth,f);
  const c=await auth.options('register',browser,token);assert.equal((await auth.verify('register',c.ceremonyId,key.registration(c.options),browser,other)).status,'denied');
  instant+=300000;assert.equal((await auth.verify('register',c.ceremonyId,key.registration(c.options),browser,token)).status,'denied');
  const d=await auth.options('register',browser,token);await auth.logout(token);assert.equal((await auth.verify('register',d.ceremonyId,key.registration(d.options),browser,token)).status,'denied');
  instant+=300000;assert.equal((await auth.options('register',browser,other)).status,'denied');
});

test('passkey removal revokes every session/link/challenge and requires fresh authentication',async t=>{
  const f=await fixture();t.after(f.cleanup);const auth=await createAuth(f.config),token=await signIn(auth,f),browser=newToken(),{key,userId}=await enroll(auth,token);
  const mail=await auth.requestMagic(f.email,browser),c=await auth.options('authenticate',browser);
  assert.equal(await auth.revokePasskey(key.id,newToken()),false);assert.equal(await auth.revokePasskey(key.id,token),true);
  assert.equal(await auth.authenticated(token),false);assert.equal((await auth.redeemMagic(mail.token,browser)).status,'denied');assert.equal((await auth.verify('authenticate',c.ceremonyId,key.authentication(c.options,userId),browser)).status,'denied');
  const again=await signIn(auth,f);assert.deepEqual((await auth.account(again)).passkeys,[]);
});

test('unknown user handle, invalid signature and different browser cannot authenticate',async t=>{
  const f=await fixture();t.after(f.cleanup);const auth=await createAuth(f.config),token=await signIn(auth,f),browser=newToken(),{key,userId}=await enroll(auth,token);
  let c=await auth.options('authenticate',browser);assert.equal((await auth.verify('authenticate',c.ceremonyId,key.authentication(c.options,newToken()),browser)).status,'denied');
  c=await auth.options('authenticate',browser);const bad=key.authentication(c.options,userId);bad.response.signature=Buffer.alloc(64).toString('base64url');assert.equal((await auth.verify('authenticate',c.ceremonyId,bad,browser)).status,'denied');
  c=await auth.options('authenticate',browser);const good=key.authentication(c.options,userId);assert.equal((await auth.verify('authenticate',c.ceremonyId,good,newToken())).status,'denied');assert.equal((await auth.verify('authenticate',c.ceremonyId,good,browser)).status,'accepted');
});

test('identity changes, old password schema and corrupt state fail closed',async t=>{
  const f=await fixture();t.after(f.cleanup);const auth=await createAuth(f.config),token=await signIn(auth,f),file=await authFile(f),original=await readFile(file);
  for(const change of [s=>s.schemaVersion=1,s=>s.ownerEmail='other@example.invalid',s=>s.workspaceId='other',s=>s.publicHost='other.example.invalid',s=>s.links=Array(11).fill({})]){const s=JSON.parse(original);change(s);await writeFile(file,JSON.stringify(s));await assert.rejects(auth.authenticated(token));await writeFile(file,original);}
  await assert.rejects((await createAuth({...f.config,ownerEmail:'other@example.invalid'})).authenticated(token));
  const other=await createAuth({...f.config,tenant:{...f.tenant,tenantId:'other-fictional'}});assert.equal(await other.authenticated(token),false);
});

test('session and flow cookies are host-only secure HTTP-only and reject duplicates',()=>{
  const token=newToken();for(const cookie of [sessionCookie(token),sessionCookie(token,false,true)]){for(const part of ['Path=/','HttpOnly','Secure','SameSite=Strict'])assert.ok(cookie.includes(part));assert.equal(cookie.includes('Domain='),false);}
  assert.equal(sessionToken(`__Host-shoof=${token}`),token);assert.equal(sessionToken(`__Host-shoof=${token}; __Host-shoof=${token}`),null);assert.match(sessionCookie('',true),/Max-Age=0/);
});

test('registration accepts only none attestation and stores no certificate identity',async t=>{
 const f=await fixture();t.after(f.cleanup);const auth=await createAuth(f.config),token=await signIn(auth,f),browser=newToken(),key=fakeAuthenticator(),c=await auth.options('register',browser,token);
 assert.equal((await auth.verify('register',c.ceremonyId,key.registration(c.options,{fmt:'packed'}),browser,token)).status,'denied');assert.deepEqual((await auth.account(token)).passkeys,[]);
});

test('concurrent redemption grants at most one session and passkey/challenge limits survive restart',async t=>{
 const f=await fixture();t.after(f.cleanup);let instant=1800000000000;const auth=await createAuth(f.config,{clock:()=>instant}),browser=newToken(),mail=await auth.requestMagic(f.email,browser);
 const results=await Promise.allSettled([auth.redeemMagic(mail.token,browser),auth.redeemMagic(mail.token,browser)]);const accepted=results.filter(r=>r.status==='fulfilled'&&r.value.status==='accepted');assert.equal(accepted.length,1);const token=accepted[0].value.token;
 for(let i=0;i<5;i++)await enroll(auth,token);
 assert.equal((await auth.options('register',newToken(),token)).status,'denied');
 for(let i=0;i<25;i++)assert.equal((await auth.options('authenticate',newToken())).status,'accepted');
 const restart=await createAuth(f.config,{clock:()=>instant});assert.equal((await restart.options('authenticate',newToken())).status,'limited');
 const state=JSON.parse(await readFile(await authFile(f)));assert.equal(state.challenges.length,10);assert.equal(state.passkeys.length,5);
 instant+=600000;assert.equal(await auth.revokePasskey(state.passkeys[0].id,token),false);instant+=300000;assert.equal((await restart.options('authenticate',newToken())).status,'accepted');
});
