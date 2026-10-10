import { execFileSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = /^(?:AGENTS\.md|README\.md|package\.json|\.gitignore|\.github\/workflows\/ci\.yml|docs\/[A-Z-]+\.md|(?:src|tools|test)\/[a-z-]+(?:\.test)?\.mjs|web\/(?:index\.html|styles\.css|app\.mjs)|examples\/(?:tenant|snapshot)\.demo\.json)$/;
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b/,
  /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/,
  /\/(?:Users|Volumes|home)\//,
  /(?:postgres(?:ql)?|mysql):\/\/[^\s]+/i
];

export function publicFileProblems(name, content) {
  const problems = [];
  if (!allowed.test(name)) problems.push('unreviewed-file-path');
  if (content.includes('\0')) problems.push('binary-content');
  if (patterns.some(pattern => pattern.test(content))) problems.push('sensitive-content-pattern');
  if (name === 'examples/tenant.demo.json') {
    try { const tenant = JSON.parse(content); if (tenant.mode !== 'demo' || tenant.tenantId !== 'fictional-harbor' || tenant.workspaceId !== 'demo-workspace' || tenant.displayName !== 'Harbor & Pine') problems.push('nonfictional-tenant'); }
    catch { problems.push('invalid-demo-json'); }
  }
  return problems;
}

export async function checkPublicTree() {
  // Include force-added ignored files and ordinary untracked files. Skip ignored
  // build outputs; those are checked as demo-only artifacts below.
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {cwd: root, encoding: 'utf8'}).split('\0').filter(Boolean);
  const failures = [];
  for (const name of new Set(files)) {
    const info = await lstat(new URL('../' + name, import.meta.url));
    if (!info.isFile() || info.size > 1024 * 1024) { failures.push(name + ': invalid-source-file'); continue; }
    const content = await readFile(new URL('../' + name, import.meta.url), 'utf8');
    for (const problem of publicFileProblems(name, content)) failures.push(name + ': ' + problem);
  }
  const report = JSON.parse(await readFile(new URL('../dist/api/report', import.meta.url), 'utf8'));
  if (report.mode !== 'demo' || report.tenant.displayName !== 'Harbor & Pine' || !report.disclaimer.startsWith('Fictional')) failures.push('dist/api/report: nonfictional-build');
  for (const name of ['index.html', 'styles.css', 'app.mjs']) {
    const [built, source] = await Promise.all([readFile(new URL('../dist/' + name, import.meta.url)), readFile(new URL('../web/' + name, import.meta.url))]);
    if (!built.equals(source)) failures.push('dist/' + name + ': unexpected-build-content');
  }
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(`Public source guards passed for ${new Set(files).size} files; fictional build verified.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkPublicTree();
