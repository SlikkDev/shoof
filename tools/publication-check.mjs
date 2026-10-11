import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { publicFileProblems } from './privacy-check.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

// Inspect committed bytes, including intermediate versions fixed later in the
// branch. A clean working tree or final commit alone cannot establish this.
export function checkPublication(base, cwd = root) {
  if (!base) throw new Error('Supply the publication base commit or ref.');
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const baseSha = git('rev-parse', '--verify', '--end-of-options', `${base}^{commit}`).trim();
  const headSha = git('rev-parse', '--verify', 'HEAD^{commit}').trim();
  git('merge-base', '--is-ancestor', baseSha, headSha);
  const commits = git('rev-list', '--reverse', `${baseSha}..${headSha}`).trim().split('\n').filter(Boolean);
  const blobs = new Map(), failures = [], fixtureCandidates = new Set();
  for (const commit of commits) {
    const changed = git('diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', commit).split('\0');
    for (const name of changed) if (/^(?:test\/|examples\/)|fixtures\.mjs$/.test(name)) fixtureCandidates.add(name);
    for (const entry of git('ls-tree', '-r', '-l', '-z', commit).split('\0').filter(Boolean)) {
      const tab = entry.indexOf('\t'), name = entry.slice(tab + 1);
      const [mode, type, oid, size] = entry.slice(0, tab).trim().split(/\s+/);
      if (!['100644', '100755'].includes(mode) || type !== 'blob' || Number(size) > 1024 * 1024) {
        failures.push(`${commit}:${name}: invalid-source-file`); continue;
      }
      if (!blobs.has(oid)) blobs.set(oid, git('cat-file', 'blob', oid));
      for (const problem of publicFileProblems(name, blobs.get(oid))) failures.push(`${commit}:${name}: ${problem}`);
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  return { baseSha, headSha, commits, fixtureCandidates: [...fixtureCandidates].sort() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: npm run review:publication -- <base-ref>');
  const result = checkPublication(process.argv[2]);
  console.log(`Committed-source guards passed for ${result.commits.length} outgoing commits (${result.baseSha}..${result.headSha}).`);
  console.log('Changed fixture candidates:', result.fixtureCandidates.join(', ') || '(none identified)');
  console.log('Before pushing, review every outgoing diff and fixture origin using docs/RELEASE-REVIEW.md. Numeric provenance cannot be established by this scanner.');
}
