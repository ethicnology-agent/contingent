export function ratio(numerator, denominator) { return denominator ? numerator / denominator : null; }

export function findingMatchesExpected(finding, expected) {
  return finding.status === 'confirmed' && finding.file === expected.file
    && (finding.symbol === expected.symbol || finding.line === expected.line);
}

export function defectMetrics(findings, expected) {
  const tp = findings.filter((finding) => findingMatchesExpected(finding, expected)).length;
  const confirmed = findings.filter((finding) => finding.status === 'confirmed');
  return { tp, fn: tp ? 0 : 1, confirmedFalsePositives: confirmed.length - tp,
    precision: ratio(tp, confirmed.length), recall: ratio(tp, 1) };
}

export function summarize(findings, caseId = '') {
  const confirmed = findings.filter((finding) => finding.status === 'confirmed').length;
  return {
    confirmed,
    hypotheses: findings.filter((finding) => finding.status === 'hypothesis').length,
    risks: findings.filter((finding) => finding.status === 'risk').length,
    abstentions: findings.filter((finding) => finding.status === 'abstained').length,
    emptyReviews: findings.length === 0 ? 1 : 0,
    emptyCleanReview: findings.length === 0,
    cleanConfirmedFalsePositives: caseId === 'clean-diff' ? confirmed : 0,
    suspiciousValidConfirmedFalsePositives: caseId === 'suspicious-valid' ? confirmed : 0,
  };
}

export function jaccard(left, right) {
  const a = new Set(left.map((finding) => finding.id));
  const b = new Set(right.map((finding) => finding.id));
  const union = new Set([...a, ...b]);
  return union.size ? [...a].filter((id) => b.has(id)).length / union.size : 1;
}

export function statusAgreement(left, right) {
  const ids = new Set([...left, ...right].map((finding) => finding.id));
  return ids.size ? [...ids].filter((id) => left.find((f) => f.id === id)?.status
    === right.find((f) => f.id === id)?.status).length / ids.size : 1;
}

export function convergenceMetrics(broken, fixed) {
  const fixedById = new Map(fixed.map((finding) => [finding.id, finding]));
  const confirmed = broken.filter((finding) => finding.status === 'confirmed');
  return {
    resolvedRepeated: confirmed.filter((finding) => fixedById.get(finding.id)?.status === 'confirmed').length,
    resolvedRecognized: confirmed.filter((finding) => {
      const postFix = fixedById.get(finding.id);
      return !postFix || postFix.status === 'resolved';
    }).length,
    newPostFixConfirmed: fixed.filter((finding) => finding.status === 'confirmed'
      && !broken.some((old) => old.id === finding.id)).length,
  };
}

export function aggregateQuality(runs, expected = null, caseId = '') {
  const successful = runs.filter((run) => run.review);
  const perRunMetrics = successful.map((run) => expected
    ? defectMetrics(run.review.findings, expected)
    : summarize(run.review.findings, caseId));
  if (!expected) {
    return {
      runs: perRunMetrics,
      confirmed: perRunMetrics.reduce((total, metric) => total + metric.confirmed, 0),
      hypotheses: perRunMetrics.reduce((total, metric) => total + metric.hypotheses, 0),
      risks: perRunMetrics.reduce((total, metric) => total + metric.risks, 0),
      abstentions: perRunMetrics.reduce((total, metric) => total + metric.abstentions, 0),
      emptyReviews: perRunMetrics.reduce((total, metric) => total + metric.emptyReviews, 0),
      cleanConfirmedFalsePositives: caseId === 'clean-diff'
        ? perRunMetrics.reduce((total, metric) => total + metric.confirmed, 0) : 0,
      suspiciousValidConfirmedFalsePositives: caseId === 'suspicious-valid'
        ? perRunMetrics.reduce((total, metric) => total + metric.confirmed, 0) : 0,
    };
  }
  const tp = perRunMetrics.reduce((total, metric) => total + metric.tp, 0);
  const fn = perRunMetrics.reduce((total, metric) => total + metric.fn, 0);
  const falsePositives = perRunMetrics.reduce((total, metric) => total + metric.confirmedFalsePositives, 0);
  return { runs: perRunMetrics, tp, fn, confirmedFalsePositives: falsePositives,
    precision: ratio(tp, tp + falsePositives), recall: ratio(tp, tp + fn) };
}

export function aggregateConvergence(pairs) {
  const perRun = pairs.map((pair) => convergenceMetrics(pair.broken, pair.fixed));
  return {
    perRun,
    resolvedRepeated: perRun.reduce((total, metric) => total + metric.resolvedRepeated, 0),
    resolvedRecognized: perRun.reduce((total, metric) => total + metric.resolvedRecognized, 0),
    newPostFixConfirmed: perRun.reduce((total, metric) => total + metric.newPostFixConfirmed, 0),
  };
}

export function aggregateRuns(runs) {
  const infrastructureCounts = {};
  for (const run of runs) if (run.infrastructure) {
    infrastructureCounts[run.infrastructure] = (infrastructureCounts[run.infrastructure] ?? 0) + 1;
  }
  const reviews = runs.filter((run) => run.review);
  const pairs = [];
  for (let i = 0; i < reviews.length; i += 1) for (let j = i + 1; j < reviews.length; j += 1) {
    pairs.push({ jaccard: jaccard(reviews[i].review.findings, reviews[j].review.findings),
      statusAgreement: statusAgreement(reviews[i].review.findings, reviews[j].review.findings) });
  }
  return { infrastructureCounts, reviews, pairwiseStability: pairs };
}
