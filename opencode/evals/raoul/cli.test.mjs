import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProcessFailure, classifySpawnError, pairRepeatSessions, parseArgs } from './cli.mjs';

test('rejects invalid repeat before fixture creation', () => {
  assert.throws(() => parseArgs(['--repeat', '0']), /positive integer/);
});

test('uses visible primary agents and review command', () => {
  const options = parseArgs(['--agent', 'codex']);
  assert.equal(options.agent, 'codex');
  assert.equal(options.command, 'review');
  assert.throws(() => parseArgs(['--agent', 'analyst-openai']), /visible primary/);
});

test('classifies provider failures without overclassifying process failures', () => {
  assert.equal(classifyProcessFailure(1, '', 'Error: provider quota exceeded'), 'provider_failure');
  assert.equal(classifyProcessFailure(
    1,
    '{"type":"error","error":{"message":"authentication failed"}}',
    '',
  ), 'provider_failure');
  assert.equal(classifyProcessFailure(1, '', 'spawn opencode ENOENT'), 'process_failure');
  assert.equal(classifyProcessFailure(1, '', 'unknown failure'), 'process_failure');
});

test('maps ENOENT spawn errors to process failure', () => {
  assert.equal(classifySpawnError({ code: 'ENOENT' }), 'process_failure');
});

test('pairs each fixed repeat with its own broken session', async () => {
  const calls = [];
  const result = await pairRepeatSessions(2, async (phase, index, sessionId) => {
    calls.push([phase, index, sessionId]);
    return phase === 'broken' ? { sessionId: `broken-${index}` } : { review: { findings: [] } };
  });
  assert.deepEqual(calls, [
    ['broken', 0, null], ['broken', 1, null],
    ['fixed', 0, 'broken-0'], ['fixed', 1, 'broken-1'],
  ]);
  assert.equal(result.fixed.length, 2);
});
