import { createHash, randomBytes } from 'node:crypto';
import { parseCookie, stringifySetCookie } from 'cookie';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { decodeAttestationObject } from '@simplewebauthn/server/helpers';
import { createObservationStore } from './observation-store.mjs';
import { validateTenant } from './tenant.mjs';
import { validatePublicHost, validateOwnerEmail } from './runtime-config.mjs';

export const sessionSeconds = 8 * 60 * 60;
export const cookieName = '__Host-shoof', flowCookieName = '__Host-shoof-flow';
const minute = 60000, lifetime = {magic: 10 * minute, register: 5 * minute, authenticate: 5 * minute};
const digest = value => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
const tokenValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const hexValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const bytesValid = (value, max = 2048) => typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value, 'base64url').toString('base64url') === value;
const stampValid = value => Number.isSafeInteger(value) && value >= 0;
const must = condition => { if (!condition) throw new Error('Invalid private authentication state'); };
export function sessionCookie(token, clear = false, flow = false) {
  return stringifySetCookie({name: flow ? flowCookieName : cookieName, value: clear ? '' : token, path: '/', httpOnly: true, secure: true, sameSite: 'strict', maxAge: clear ? 0 : flow ? 600 : sessionSeconds});
}
export function sessionToken(header, name = cookieName) {
  if (typeof header !== 'string' || header.split(';').filter(part => part.trim().startsWith(name + '=')).length !== 1) return null;
  const value = parseCookie(header)[name]; return tokenValid(value) ? value : null;
}
function responseValid(response) {
  if (!response || JSON.stringify(response).length > 24576 || !bytesValid(response.id) || response.id !== response.rawId || response.type !== 'public-key' || !bytesValid(response.response?.clientDataJSON, 8192)) return false;
  try { const client = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url')); return client.crossOrigin !== true && client.topOrigin === undefined; } catch { return false; }
}

export async function createAuth({tenant, directory, ownerEmail, publicHost}, {clock = Date.now} = {}) {
  tenant = validateTenant(structuredClone(tenant)); if (tenant.mode !== 'private') throw new Error('Private tenant required');
  ownerEmail = validateOwnerEmail(ownerEmail); publicHost = validatePublicHost(publicHost);
  const origin = 'https://' + publicHost, store = await createObservationStore(directory);
  const scope = {tenantId: tenant.tenantId, sourceId: 'authentication', jobId: 'owner'};
  const now = () => { const value = clock(); must(stampValid(value)); return value; };
  const blank = () => ({schemaVersion: 2, tenantId: tenant.tenantId, workspaceId: tenant.workspaceId, ownerEmail, publicHost, userId: newToken(), attempts: {magic: [], passkey: []}, links: [], challenges: [], passkeys: [], sessions: []});
  function checked(s) {
    must(s && s.schemaVersion === 2 && s.tenantId === tenant.tenantId && s.workspaceId === tenant.workspaceId && s.ownerEmail === ownerEmail && s.publicHost === publicHost && tokenValid(s.userId));
    for (const kind of ['magic', 'passkey']) must(Array.isArray(s.attempts?.[kind]) && s.attempts[kind].length <= 30 && s.attempts[kind].every(stampValid));
    for (const [key, max] of [['sessions', 10], ['links', 10], ['challenges', 10], ['passkeys', 5]]) must(Array.isArray(s[key]) && s[key].length <= max);
    const sessions = s.sessions.map(v => { must(hexValid(v.digest) && stampValid(v.createdAt) && v.expiresAt - v.createdAt === sessionSeconds * 1000 && stampValid(v.expiresAt) && (v.credentialId === null || bytesValid(v.credentialId))); return {digest: v.digest, createdAt: v.createdAt, expiresAt: v.expiresAt, credentialId: v.credentialId}; });
    const links = s.links.map(v => { must(hexValid(v.digest) && hexValid(v.browser) && stampValid(v.createdAt) && stampValid(v.expiresAt) && v.expiresAt - v.createdAt === lifetime.magic); return {digest: v.digest, browser: v.browser, createdAt: v.createdAt, expiresAt: v.expiresAt}; });
    const challenges = s.challenges.map(v => { must(tokenValid(v.id) && tokenValid(v.challenge) && ['register', 'authenticate'].includes(v.kind) && hexValid(v.browser) && (v.session === null || hexValid(v.session)) && stampValid(v.createdAt) && stampValid(v.expiresAt) && v.expiresAt - v.createdAt === lifetime[v.kind]); return {id: v.id, challenge: v.challenge, kind: v.kind, browser: v.browser, session: v.session, createdAt: v.createdAt, expiresAt: v.expiresAt}; });
    const passkeys = s.passkeys.map(v => { must(bytesValid(v.id) && bytesValid(v.publicKey, 4096) && stampValid(v.counter) && stampValid(v.createdAt)); return {id: v.id, publicKey: v.publicKey, counter: v.counter, createdAt: v.createdAt}; });
    for (const [list, key] of [[sessions, 'digest'], [links, 'digest'], [challenges, 'id'], [passkeys, 'id']]) must(new Set(list.map(v => v[key])).size === list.length);
    return {...blank(), userId: s.userId, attempts: {magic: [...s.attempts.magic], passkey: [...s.attempts.passkey]}, sessions, links, challenges, passkeys};
  }
  async function locked(callback) { const result = await store.withLock(scope, callback); if (result?.status === 'busy') throw new Error('Authentication busy'); return result; }
  const live = (v, instant) => v.createdAt <= instant && v.expiresAt > instant;
  function session(s, token, instant, recent = false) { return tokenValid(token) && s.sessions.find(v => v.digest === digest(token) && live(v, instant) && (!recent || instant - v.createdAt < 10 * minute)); }
  function prune(s, instant) { s.links = s.links.filter(v => live(v, instant)); s.challenges = s.challenges.filter(v => live(v, instant)); s.sessions = s.sessions.filter(v => live(v, instant)); }
  function charge(s, kind, instant) { s.attempts[kind] = s.attempts[kind].filter(v => instant - v < 15 * minute); if (s.attempts[kind].length >= (kind === 'magic' ? 10 : 30)) return false; s.attempts[kind].push(instant); return true; }
  function grant(s, previous, instant, credentialId = null) { const token = newToken(); s.sessions = s.sessions.filter(v => live(v, instant) && (!tokenValid(previous) || v.digest !== digest(previous))).slice(-9); s.sessions.push({digest: digest(token), createdAt: instant, expiresAt: instant + sessionSeconds * 1000, credentialId}); return {status: 'accepted', token}; }
  return Object.freeze({
    async requestMagic(email, browser) {
      if (!tokenValid(browser)) throw new Error('Invalid browser flow');
      return locked(async tx => {
        const stored = await tx.read(), s = stored ? checked(stored) : blank(), instant = now(); prune(s, instant);
        const allowed = charge(s, 'magic', instant), token = newToken();
        const eligible = allowed && typeof email === 'string' && email.length <= 254 && email.trim().toLowerCase() === ownerEmail;
        if (eligible) s.links.push({digest: digest(token), browser: digest(browser), createdAt: instant, expiresAt: instant + lifetime.magic});
        await tx.write(s);
        return eligible ? {to: ownerEmail, token, url: origin + '/login#token=' + token} : null;
      });
    },
    async cancelMagic(token) { if (!tokenValid(token)) return; return locked(async tx => { const stored = await tx.read(); if (!stored) return; const s = checked(stored); s.links = s.links.filter(v => v.digest !== digest(token)); await tx.write(s); }); },
    async redeemMagic(token, browser, previous) {
      if (!tokenValid(token) || !tokenValid(browser)) return {status: 'denied'};
      return locked(async tx => {
        const stored = await tx.read(); if (!stored) return {status: 'denied'}; const s = checked(stored), instant = now();
        const link = s.links.find(v => v.digest === digest(token) && v.browser === digest(browser) && live(v, instant));
        if (!link) return {status: 'denied'}; s.links = s.links.filter(v => v !== link);
        const result = grant(s, previous, instant); await tx.write(s); return result;
      });
    },
    async options(kind, browser, token) {
      if (!['register', 'authenticate'].includes(kind) || !tokenValid(browser)) return {status: 'denied'};
      return locked(async tx => {
        const stored = await tx.read(), s = stored ? checked(stored) : blank(), instant = now(); prune(s, instant);
        const current = session(s, token, instant, true);
        if (kind === 'register' && (!current || s.passkeys.length >= 5)) return {status: 'denied'};
        if (!charge(s, 'passkey', instant)) return {status: 'limited'};
        const options = kind === 'register'
          ? await generateRegistrationOptions({rpName: 'Shoof', rpID: publicHost, userName: ownerEmail, userID: Buffer.from(s.userId, 'base64url'), attestationType: 'none', supportedAlgorithmIDs: [-7, -257], authenticatorSelection: {residentKey: 'required', userVerification: 'required'}, excludeCredentials: s.passkeys.map(v => ({id: v.id}))})
          : await generateAuthenticationOptions({rpID: publicHost, userVerification: 'required'});
        const id = newToken();
        s.challenges = s.challenges.filter(v => !(v.kind === kind && v.browser === digest(browser))).slice(-9);
        s.challenges.push({id, challenge: options.challenge, kind, browser: digest(browser), session: kind === 'register' ? current.digest : null, createdAt: instant, expiresAt: instant + lifetime[kind]});
        await tx.write(s); return {status: 'accepted', ceremonyId: id, options};
      });
    },
    async verify(kind, ceremonyId, response, browser, token) {
      if (!tokenValid(ceremonyId) || !tokenValid(browser)) return {status: 'denied'};
      return locked(async tx => {
        const stored = await tx.read(); if (!stored) return {status: 'denied'};
        const s = checked(stored), instant = now(), current = session(s, token, instant, true);
        const challenge = s.challenges.find(v => v.id === ceremonyId && v.kind === kind && v.browser === digest(browser) && live(v, instant) && (kind !== 'register' || (current && current.digest === v.session)));
        if (!challenge) return {status: 'denied'};
        s.challenges = s.challenges.filter(v => v !== challenge); await tx.write(s); // Consume before verification, including failed attempts.
        if (!responseValid(response)) return {status: 'denied'};
        try {
          if (kind === 'register') {
            if (s.passkeys.length >= 5 || s.passkeys.some(v => v.id === response.id)) return {status: 'denied'};
            // Only privacy-preserving 'none' attestation is needed; never follow
            // certificate/revocation paths selected by an untrusted attestation.
            if (!bytesValid(response.response.attestationObject, 24576) || decodeAttestationObject(Buffer.from(response.response.attestationObject, 'base64url')).get('fmt') !== 'none') return {status: 'denied'};
            const result = await verifyRegistrationResponse({response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: publicHost, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257]});
            if (!result.verified || !session(s, token, now(), true) || !live(challenge, now())) return {status: 'denied'};
            const key = result.registrationInfo.credential;
            s.passkeys.push({id: key.id, publicKey: Buffer.from(key.publicKey).toString('base64url'), counter: key.counter, createdAt: now()});
            await tx.write(checked(s)); return {status: 'accepted'};
          }
          const key = s.passkeys.find(v => v.id === response.id);
          if (!key || response.response.userHandle !== s.userId) return {status: 'denied'};
          const result = await verifyAuthenticationResponse({response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: publicHost, credential: {...key, publicKey: new Uint8Array(Buffer.from(key.publicKey, 'base64url'))}, requireUserVerification: true});
          if (!result.verified || !live(challenge, now())) return {status: 'denied'};
          key.counter = result.authenticationInfo.newCounter;
          const granted = grant(s, token, now(), key.id); await tx.write(checked(s)); return granted;
        } catch { return {status: 'denied'}; }
      });
    },
    async authenticated(token) { if (!tokenValid(token)) return false; const stored = await store.read(scope); return !!(stored && session(checked(stored), token, now())); },
    async account(token) { const stored = await store.read(scope); if (!stored) return null; const s = checked(stored); if (!session(s, token, now())) return null; return {email: ownerEmail, recent: !!session(s, token, now(), true), passkeys: s.passkeys.map(({id, createdAt}) => ({id, createdAt}))}; },
    async revokePasskey(id, token) { return locked(async tx => { const stored = await tx.read(); if (!stored) return false; const s = checked(stored); if (!session(s, token, now(), true) || !s.passkeys.some(v => v.id === id)) return false; s.passkeys = s.passkeys.filter(v => v.id !== id); s.sessions = []; s.challenges = []; s.links = []; await tx.write(s); return true; }); },
    async logout(token) { if (!tokenValid(token)) return; return locked(async tx => { const stored = await tx.read(); if (!stored) return; const s = checked(stored); s.sessions = s.sessions.filter(v => v.digest !== digest(token)); s.challenges = s.challenges.filter(v => v.session !== digest(token)); await tx.write(s); }); },
  });
}
