import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvalidDiagnostic, extractAssistant, extractJsonEvents, parseReview } from './parser.mjs';

const good = {
  schemaVersion: 1,
  caseId: 'x',
  phase: 'changed',
  reviewStatus: 'clean',
  findings: [],
};

test('parses event streams defensively', () => {
  const event = { type: 'text', text: JSON.stringify(good), sessionID: 's1' };
  assert.deepEqual(extractAssistant(extractJsonEvents(`noise\n${JSON.stringify(event)}`)), {
    text: JSON.stringify(good),
    sessionId: 's1',
    metadata: { tokens: null, cost: null },
  });
});

test('rejects invalid review output', () => {
  assert.equal(parseReview('{}').reason, 'invalid_output');
});

test('rejects closed-schema violations and missing confirmed locations', () => {
  assert.equal(parseReview(JSON.stringify({ ...good, reviewStatus: 'maybe' })).reason, 'invalid_output');
  assert.equal(parseReview(JSON.stringify({
    ...good,
    findings: [{
      id: 'x', status: 'confirmed', severity: 'high', file: 'x.mjs', summary: 'x',
      contract: 'x', evidence: 'x', impact: 'x', correctionDirection: 'x',
    }],
  })).reason, 'invalid_output');
});

test('validates case and phase against the expected review context', () => {
  assert.equal(parseReview(JSON.stringify({ ...good, caseId: 'wrong' }), {
    caseId: 'x', phase: 'changed',
  }).reason, 'invalid_output');
  assert.equal(parseReview(JSON.stringify({ ...good, phase: 'fixed' }), {
    caseId: 'x', phase: 'changed',
  }).reason, 'invalid_output');
});

test('extracts the documented message.part.updated SDK event shape', () => {
  const event = {
    type: 'message.part.updated',
    properties: {
      part: { type: 'text', text: JSON.stringify(good), sessionID: 's2' },
      delta: JSON.stringify(good),
    },
  };
  assert.equal(extractAssistant([event]).text, JSON.stringify(good));
  assert.equal(extractAssistant([event]).sessionId, 's2');
});

test('builds bounded invalid-output diagnostics for distinct failure shapes', () => {
  const diagnostic = buildInvalidDiagnostic({
    events: [{ type: 'message.updated' }, { type: 'message.part.updated' }],
    assistantText: 'prefix {"not":"accepted"}',
    reason: 'invalid_output',
    sessionId: null,
  });
  assert.deepEqual(diagnostic, {
    reason: 'invalid_output',
    eventCount: 2,
    eventTypes: ['message.updated', 'message.part.updated'],
    assistantText: 'prefix {"not":"accepted"}',
    sessionIdPresent: false,
  });
  assert.ok(diagnostic.assistantText.length <= 8192);
});
