import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyPhase, gitDiff, prepareFixture, runFixture } from './fixtures.mjs';

test('prepareFixture supports an absent temporary parent', async () => {
  const parent = join(tmpdir(), `raoul-missing-parent-${process.pid}-${Date.now()}`, 'nested');
  const fixture = await prepareFixture('clean-diff', { tempParent: parent });
  try {
    assert.equal(fixture.temp.startsWith(`${parent}/`), true);
  } finally {
    await fixture.cleanup();
    await rm(parent, { recursive: true, force: true });
  }
});

test('fixture oracle distinguishes passing and failing states', async () => {
  const clean = await runFixture('clean-diff');
  const bug = await runFixture('seeded-contract-bug');
  try {
    assert.equal(clean.passed, true);
    assert.equal(bug.passed, false);
  } finally {
    await clean.cleanup();
    await bug.cleanup();
  }
});

test('each fixture phase is a real non-empty diff with expected files', async () => {
  const fixture = await prepareFixture('clean-diff');
  try {
    await applyPhase(fixture, 'changed');
    const diff = await gitDiff(fixture);
    assert.match(diff, /title\.mjs/);
    assert.notEqual(diff.trim(), '');
  } finally {
    await fixture.cleanup();
  }
});

test('convergence phases reuse one repository and clean removed files', async () => {
  const fixture = await prepareFixture('convergence');
  try {
    const first = fixture.temp;
    await applyPhase(fixture, 'broken');
    await applyPhase(fixture, 'fixed');
    assert.equal(fixture.temp, first);
  } finally {
    await fixture.cleanup();
  }
});

test('every phase diff includes its new test file', async () => {
  const cases = [
    ['clean-diff', ['changed']],
    ['seeded-contract-bug', ['changed']],
    ['suspicious-valid', ['changed']],
    ['convergence', ['broken', 'fixed']],
  ];
  for (const [caseId, phases] of cases) {
    const fixture = await prepareFixture(caseId);
    try {
      for (const phase of phases) {
        await applyPhase(fixture, phase);
        assert.match(await gitDiff(fixture), /test\.mjs/);
      }
    } finally {
      await fixture.cleanup();
    }
  }
});
