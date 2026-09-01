import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);

async function pluginUrlRules() {
  const source = await readFile(new URL('./git-identity.ts', import.meta.url), 'utf8');
  return [...source.matchAll(/\["(url\.[^"]+\.insteadOf)",\s*"([^"]+)"\]/g)]
    .map(([, key, value]) => [key, value]);
}

test('plugin rules route GitHub SCP and ssh URLs through HTTPS', async () => {
  const rules = await pluginUrlRules();
  const root = await mkdtemp(join(tmpdir(), 'git-identity-test-'));
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_TRACE: '1' };
  rules.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  env.GIT_CONFIG_COUNT = String(rules.length);

  try {
    for (const url of ['git@github.com:owner/repo.git', 'ssh://git@github.com/owner/repo.git']) {
      const result = await exec('git', ['ls-remote', url], { cwd: root, env, timeout: 2000 })
        .then(() => ({ stderr: '' }), (error) => error);
      assert.match(result.stderr, /remote-https .*https:\/\/github\.com\/owner\/repo\.git/,
        `Git did not resolve ${url} through HTTPS`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
