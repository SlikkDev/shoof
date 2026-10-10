import { constants } from 'node:fs';
import { lstat, realpath, open, mkdir, rmdir, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, relative, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const maxBytes = 8 * 1024 * 1024;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);

export function projectJobScope(scope) {
  if (!scope || !['tenantId', 'sourceId', 'jobId'].every(key => identifier(scope[key]))) throw new Error('Invalid job scope');
  return {tenantId: scope.tenantId, sourceId: scope.sourceId, jobId: scope.jobId};
}

// This is private local storage, not a public API or a shared-host auth layer.
// Its parent and all ancestors must be controlled by the runtime owner.
export async function createObservationStore(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('External absolute store directory required');
  const root = await realpath(directory), repo = await realpath(repository);
  const rel = relative(repo, root);
  if (!rel || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))) throw new Error('Observation store must be outside the repository');
  const rootInfo = await lstat(directory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (rootInfo.mode & 0o077) !== 0 || (process.getuid && rootInfo.uid !== process.getuid())) throw new Error('Store directory must be owner-only and not a symlink');

  const filename = scope => join(root, createHash('sha256').update(JSON.stringify(projectJobScope(scope))).digest('hex'));
  async function read(file) {
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || info.size > maxBytes || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error('Invalid private state file');
      const value = JSON.parse(await handle.readFile('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid private state shape');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error('Cannot read private sync state');
    } finally { await handle?.close(); }
  }
  async function write(file, value, {shouldCommit = () => true} = {}) {
    if (typeof shouldCommit !== 'function') throw new Error('Synchronous commit guard required');
    if (shouldCommit() !== true) return false;
    const bytes = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(bytes) > maxBytes) throw new Error('Private state exceeds size limit');
    const temp = file + '.' + randomUUID() + '.tmp';
    let handle;
    try {
      handle = await open(temp, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close(); handle = null;
      // Recheck after asynchronous preparation, immediately before dispatching
      // the atomic replacement. A rejected candidate leaves the old file intact.
      if (shouldCommit() !== true) return false;
      await rename(temp, file);
      return true;
    } finally {
      await handle?.close();
      await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  return Object.freeze({
    async withLock(scope, callback) {
      const base = filename(scope), lock = base + '.lock', file = base + '.json';
      try { await mkdir(lock, {mode: 0o700}); }
      catch (error) { if (error.code === 'EEXIST') return {status: 'busy'}; throw new Error('Cannot lock private sync state'); }
      try { return await callback({read: () => read(file), write: (value, options) => write(file, value, options)}); }
      finally { await rmdir(lock); }
    }
  });
}
