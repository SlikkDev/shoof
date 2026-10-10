import test from 'node:test';
import assert from 'node:assert/strict';
import { publicFileProblems } from '../tools/privacy-check.mjs';

test('public source guards reject private paths, artifacts, credentials and non-demo tenant inputs', () => {
  for (const path of ['.env', 'runtime/state.json', 'examples/customer.json', 'artifacts/screenshot.png', '../outside.mjs']) assert.ok(publicFileProblems(path, '{}').includes('unreviewed-file-path'));
  for (const value of ['-----BEGIN ' + 'PRIVATE KEY-----', 'ghp_' + 'x'.repeat(36), ['','Users','fictional','file'].join('/'), 'postgres' + '://user:pass@example.invalid/database']) assert.ok(publicFileProblems('README.md', value).includes('sensitive-content-pattern'));
  assert.ok(publicFileProblems('examples/tenant.demo.json', '{"mode":"private"}').includes('nonfictional-tenant'));
  assert.ok(publicFileProblems('src/example.mjs', '\0').includes('binary-content'));
  assert.deepEqual(publicFileProblems('src/sync.mjs', '// Fictional demo only'), []);
});
