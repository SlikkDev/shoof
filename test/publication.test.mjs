import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPublication } from '../tools/publication-check.mjs';

async function repository(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'fictional-publication-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Fictional reviewer');
  git('config', 'user.email', 'reviewer@example.test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  await writeFile(join(cwd, 'README.md'), 'Fictional repository.\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'Fictional base');
  const base = git('rev-parse', 'HEAD');
  await mkdir(join(cwd, 'test'));
  const commitFixture = async content => {
    await writeFile(join(cwd, 'test', 'example.test.mjs'), content);
    git('add', '.'); git('commit', '--quiet', '-m', 'Fictional fixture revision');
  };
  return { cwd, git, base, commitFixture };
}

test('reports exact committed scope and fixture candidates, without claiming metric provenance', async t => {
  const f = await repository(t);
  await f.commitFixture('// Invented solely for an empty-import test.\nexport const rows = [];\n');
  const result = checkPublication(f.base, f.cwd);
  assert.equal(result.baseSha, f.base);
  assert.equal(result.headSha, f.git('rev-parse', 'HEAD'));
  assert.deepEqual(result.commits, [result.headSha]);
  assert.deepEqual(result.fixtureCandidates, ['test/example.test.mjs']);
  assert.throws(() => checkPublication('', f.cwd));
  assert.throws(() => checkPublication('missing-ref', f.cwd));
});

test('rejects unsafe committed history even when later commits and working files are clean', async t => {
  const f = await repository(t);
  // A deliberately invalid marker, never a real key or private metric.
  await f.commitFixture('// -----BEGIN ' + 'PRIVATE KEY-----\n');
  const unsafe = f.git('rev-parse', 'HEAD');
  await f.commitFixture('// Wholly invented replacement.\n');
  assert.throws(() => checkPublication(f.base, f.cwd), error => error.message.includes(unsafe) && error.message.includes('sensitive-content-pattern'));
});

test('rejects unreviewed files in an intermediate commit after their deletion', async t => {
  const f = await repository(t);
  await writeFile(join(f.cwd, 'unreviewed.json'), '{}');
  f.git('add', '.'); f.git('commit', '--quiet', '-m', 'Fictional unreviewed file');
  f.git('rm', '--quiet', 'unreviewed.json'); f.git('commit', '--quiet', '-m', 'Remove fixture');
  assert.throws(() => checkPublication(f.base, f.cwd), /unreviewed-file-path/);
});
