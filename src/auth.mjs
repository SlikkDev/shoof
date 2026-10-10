import { createHash, randomBytes } from 'node:crypto';
import { hash, verify, parseOptions, Algorithm, Version } from '@node-rs/argon2';
import { parseCookie, stringifySetCookie } from 'cookie';
import { createObservationStore } from './observation-store.mjs';
import { validateTenant } from './tenant.mjs';

export const sessionSeconds = 8 * 60 * 60;
export const cookieName = '__Host-shoof';
const windowMs = 15 * 60 * 1000, maxAttempts = 10, maxSessions = 10;
const policy = {algorithm: Algorithm.Argon2id, version: Version.V0x13, memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32};
const digest = value => createHash('sha256').update(value).digest('hex');
const tokenValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const emailValid = value => typeof value === 'string' && value.length <= 254 && /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(value);
const passwordValid = value => typeof value === 'string' && [...value].length >= 15 && [...value].length <= 128 && Buffer.byteLength(value) <= 512;
const stampValid = value => Number.isSafeInteger(value) && value >= 0;
const must = condition => { if (!condition) throw new Error('Invalid private authentication state'); };

export function sessionCookie(token, clear = false) {
  return stringifySetCookie({name: cookieName, value: clear ? '' : token, path: '/', httpOnly: true, secure: true, sameSite: 'strict', maxAge: clear ? 0 : sessionSeconds});
}
export function sessionToken(header) {
  if (typeof header !== 'string' || header.split(';').filter(part => part.trim().startsWith(cookieName + '=')).length !== 1) return null;
  const value = parseCookie(header)[cookieName];
  return tokenValid(value) ? value : null;
}

export async function createAuth({tenant, directory}, {clock = Date.now} = {}) {
  tenant = validateTenant(structuredClone(tenant));
  if (tenant.mode !== 'private') throw new Error('Private tenant required');
  const store = await createObservationStore(directory);
  const scope = {tenantId: tenant.tenantId, sourceId: 'authentication', jobId: 'owner'};
  const now = () => { const value = clock(); must(stampValid(value)); return value; };
  function checked(value) {
    must(value && value.schemaVersion === 1 && value.tenantId === tenant.tenantId && value.workspaceId === tenant.workspaceId && emailValid(value.email));
    must(typeof value.passwordHash === 'string' && /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/.test(value.passwordHash));
    const options = parseOptions(value.passwordHash);
    must(Object.entries(policy).every(([key, expected]) => options[key] === expected) && options.saltLen === 16);
    must(Array.isArray(value.attempts) && value.attempts.length <= maxAttempts && value.attempts.every(stampValid));
    must(Array.isArray(value.sessions) && value.sessions.length <= maxSessions);
    const sessions = value.sessions.map(s => {
      must(s && /^[a-f0-9]{64}$/.test(s.digest) && stampValid(s.createdAt) && stampValid(s.expiresAt) && s.expiresAt - s.createdAt === sessionSeconds * 1000);
      return {digest: s.digest, createdAt: s.createdAt, expiresAt: s.expiresAt};
    });
    must(new Set(sessions.map(s => s.digest)).size === sessions.length);
    return {schemaVersion: 1, tenantId: tenant.tenantId, workspaceId: tenant.workspaceId, email: value.email, passwordHash: value.passwordHash, attempts: [...value.attempts], sessions};
  }
  async function locked(callback) {
    const result = await store.withLock(scope, callback);
    if (result?.status === 'busy') throw new Error('Authentication busy');
    return result;
  }
  return Object.freeze({
    async setup(email, password, {reset = false} = {}) {
      if (!emailValid(email) || !passwordValid(password)) throw new Error('Use a valid email and a password of 15–128 characters (at most 512 UTF-8 bytes)');
      return locked(async tx => {
        const previous = await tx.read();
        if (previous) checked(previous);
        if (reset ? !previous : previous) throw new Error(reset ? 'Owner account not initialized' : 'Owner account already initialized');
        const passwordHash = await hash(password, policy);
        await tx.write({schemaVersion: 1, tenantId: tenant.tenantId, workspaceId: tenant.workspaceId, email: email.trim().toLowerCase(), passwordHash, attempts: [], sessions: []});
        return true;
      });
    },
    async login(email, password, previousToken) {
      if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || !password.length || Buffer.byteLength(password) > 512) return {status: 'denied'};
      return locked(async tx => {
        const stored = await tx.read();
        if (!stored) return {status: 'unavailable'};
        const state = checked(stored), instant = now();
        // All usernames share this persisted budget; forwarded IPs cannot reset it.
        state.attempts = state.attempts.filter(time => instant - time < windowMs);
        if (state.attempts.length >= maxAttempts) return {status: 'limited'};
        state.attempts.push(instant);
        await tx.write(state); // Charge the attempt even if hashing is interrupted.
        const matches = await verify(state.passwordHash, password);
        if (!matches || email.trim().toLowerCase() !== state.email) return {status: 'denied'};
        const token = randomBytes(32).toString('base64url');
        const oldDigest = tokenValid(previousToken) ? digest(previousToken) : null;
        state.sessions = state.sessions.filter(s => s.expiresAt > instant && s.createdAt <= instant && s.digest !== oldDigest).slice(-(maxSessions - 1));
        state.sessions.push({digest: digest(token), createdAt: instant, expiresAt: instant + sessionSeconds * 1000});
        await tx.write(state);
        return {status: 'accepted', token};
      });
    },
    async authenticated(token) {
      if (!tokenValid(token)) return false;
      const value = await store.read(scope); if (!value) return false;
      const state = checked(value), instant = now(), key = digest(token);
      return state.sessions.some(s => s.digest === key && s.createdAt <= instant && s.expiresAt > instant);
    },
    async logout(token) {
      if (!tokenValid(token)) return;
      await locked(async tx => {
        const value = await tx.read(); if (!value) return true;
        const state = checked(value), key = digest(token);
        if (!state.sessions.some(s => s.digest === key)) return true;
        state.sessions = state.sessions.filter(s => s.digest !== key);
        await tx.write(state); return true;
      });
    },
  });
}
