import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export async function loadFixture(caseId) {
  return JSON.parse(await readFile(join(root, caseId, 'manifest.json'), 'utf8'));
}

export async function prepareFixture(caseId, { tempParent } = {}) {
  const manifest = await loadFixture(caseId);
  const parent = tempParent ?? join(tmpdir(), 'opencode');
  await mkdir(parent, { recursive: true });
  const temp = await mkdtemp(join(parent, 'raoul-evals-'));
  await cp(join(root, caseId, 'baseline'), temp, { recursive: true });
  await exec('git', ['init', '-q', temp]);
  const git = (args) => exec('git', ['-C', temp, '-c', 'user.name=Raoul Eval',
    '-c', 'user.email=raoul-eval@example.invalid', '-c', 'commit.gpgSign=false', ...args]);
  await git(['add', '.']);
  await git(['commit', '-qm', 'baseline']);
  return { caseId, manifest, temp, git, cleanup: () => rm(temp, { recursive: true, force: true }) };
}

export async function applyPhase(fixture, phase) {
  await fixture.git(['reset', '--hard', '-q', 'HEAD']);
  await fixture.git(['clean', '-fdq']);
  await cp(join(root, fixture.caseId, phase), fixture.temp, { recursive: true });
  await fixture.git(['add', '-N', '--', '.']);
}

export async function gitDiff(fixture) {
  return (await fixture.git(['diff', '--no-ext-diff'])).stdout;
}

export async function runTests(fixture) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    const result = await exec('node', ['--test', fixture.manifest.test], { cwd: fixture.temp, env });
    return { passed: true, output: result.stdout };
  } catch (error) {
    return { passed: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

export async function runFixture(caseId, phase = 'changed') {
  const fixture = await prepareFixture(caseId);
  try { await applyPhase(fixture, phase); return { ...fixture, ...(await runTests(fixture)) }; }
  catch (error) { await fixture.cleanup(); throw error; }
}
