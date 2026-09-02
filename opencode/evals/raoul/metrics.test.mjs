import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateQuality,
  aggregateRuns,
  aggregateConvergence,
  convergenceMetrics,
  defectMetrics,
  jaccard,
  ratio,
  statusAgreement,
  summarize,
} from './metrics.mjs';

test('keeps zero denominators descriptive', () => {
  assert.equal(ratio(0, 0), null);
});

test('matches seeded defects by location or symbol', () => {
  assert.deepEqual(
    defectMetrics([{ id: 'a', status: 'confirmed', file: 'x.mjs', symbol: 'f' }], {
      file: 'x.mjs', symbol: 'f',
    }),
    { tp: 1, fn: 0, confirmedFalsePositives: 0, precision: 1, recall: 1 },
  );
});

test('compares repeated finding sets and statuses', () => {
  const left = [{ id: 'a', status: 'risk' }];
  const right = [{ id: 'a', status: 'confirmed' }];
  assert.equal(jaccard(left, right), 1);
  assert.equal(statusAgreement(left, right), 0);
});

test('reports clean and suspicious confirmed false positives separately', () => {
  const findings = [
    { id: 'clean', status: 'confirmed' },
    { id: 'risk', status: 'risk' },
    { id: 'abstain', status: 'abstained' },
  ];
  assert.equal(summarize(findings, 'clean-diff').cleanConfirmedFalsePositives, 1);
  assert.equal(summarize(findings, 'suspicious-valid').suspiciousValidConfirmedFalsePositives, 1);
});

test('compares convergence resolution and post-fix findings', () => {
  const broken = [{ id: 'bug', status: 'confirmed' }];
  assert.deepEqual(convergenceMetrics(broken, [{ id: 'bug', status: 'resolved' }]), {
    resolvedRepeated: 0, resolvedRecognized: 1, newPostFixConfirmed: 0,
  });
  assert.deepEqual(convergenceMetrics(broken, []), {
    resolvedRepeated: 0, resolvedRecognized: 1, newPostFixConfirmed: 0,
  });
  assert.deepEqual(convergenceMetrics(broken, [{ id: 'bug', status: 'confirmed' }]), {
    resolvedRepeated: 1, resolvedRecognized: 0, newPostFixConfirmed: 0,
  });
  assert.deepEqual(convergenceMetrics([], [{ id: 'new', status: 'confirmed' }]), {
    resolvedRepeated: 0, resolvedRecognized: 0, newPostFixConfirmed: 1,
  });
});

test('aggregates every repeated run', () => {
  assert.equal(aggregateRuns([
    { review: { findings: [] } },
    { review: { findings: [{ id: 'x', status: 'risk' }] } },
    { infrastructure: 'timeout' },
  ]).infrastructureCounts.timeout, 1);
});

test('aggregates quality over every successful repeat', () => {
  const result = aggregateQuality([
    { review: { findings: [{ id: 'bug', status: 'confirmed', file: 'x', line: 1 }] } },
    { review: { findings: [] } },
    { review: { findings: [{ id: 'noise', status: 'confirmed', file: 'y', line: 2 }] } },
  ], { file: 'x', line: 1 });
  assert.equal(result.runs.length, 3);
  assert.equal(result.tp, 1);
  assert.equal(result.fn, 2);
  assert.equal(result.confirmedFalsePositives, 1);
});

test('keeps empty reviews distinct from explicit abstentions', () => {
  const result = aggregateQuality([
    { review: { findings: [] } },
    { review: { findings: [{ id: 'a', status: 'abstained' }] } },
  ], null, 'clean-diff');
  assert.equal(result.emptyReviews, 1);
  assert.equal(result.abstentions, 1);
});

test('aggregates convergence totals across every repeat pair', () => {
  const result = aggregateConvergence([
    { broken: [{ id: 'a', status: 'confirmed' }], fixed: [{ id: 'a', status: 'resolved' }] },
    { broken: [{ id: 'b', status: 'confirmed' }], fixed: [{ id: 'b', status: 'confirmed' }, { id: 'c', status: 'confirmed' }] },
  ]);
  assert.deepEqual(result, {
    perRun: [
      { resolvedRepeated: 0, resolvedRecognized: 1, newPostFixConfirmed: 0 },
      { resolvedRepeated: 1, resolvedRecognized: 0, newPostFixConfirmed: 1 },
    ],
    resolvedRepeated: 1,
    resolvedRecognized: 1,
    newPostFixConfirmed: 1,
  });
});
