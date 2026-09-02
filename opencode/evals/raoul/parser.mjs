export const STATUSES = new Set([
  'confirmed', 'hypothesis', 'risk', 'resolved', 'unchanged', 'invalid', 'abstained',
]);
export const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
export const REVIEW_STATUSES = new Set(['clean', 'findings', 'abstained']);

export function extractJsonEvents(text) {
  return text.split('\n').flatMap((line) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

export function extractAssistant(events) {
  const text = events
    .filter((event) => event.type === 'text' || event.type === 'message' || event.type === 'message.part'
      || event.type === 'message.part.updated')
    .map((event) => event.text ?? event.part?.text ?? event.message?.content
      ?? event.properties?.part?.text ?? '')
    .join('');
  const session = events.find((event) => event.sessionID || event.sessionId
    || event.properties?.sessionID || event.properties?.part?.sessionID);
  const usage = events.find((event) => event.usage || event.cost != null || event.tokens);
  return {
    text,
    sessionId: session?.sessionID ?? session?.sessionId ?? session?.properties?.sessionID
      ?? session?.properties?.part?.sessionID ?? null,
    metadata: usage ? {
      tokens: usage.tokens ?? usage.usage?.total_tokens ?? null,
      cost: usage.cost ?? usage.usage?.cost ?? null,
    } : { tokens: null, cost: null },
  };
}

export function buildInvalidDiagnostic({ events, assistantText, reason, sessionId }) {
  return {
    reason,
    eventCount: events.length,
    eventTypes: events.map((event) => event.type).filter(Boolean).slice(0, 32),
    assistantText: assistantText.slice(0, 8192),
    sessionIdPresent: Boolean(sessionId),
  };
}

export function parseReview(text, expected = null) {
  let value;
  try { value = JSON.parse(text.trim()); } catch { return { ok: false, reason: 'invalid_output' }; }
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1
    || typeof value.caseId !== 'string' || typeof value.phase !== 'string'
    || !REVIEW_STATUSES.has(value.reviewStatus) || !Array.isArray(value.findings)) {
    return { ok: false, reason: 'invalid_output' };
  }
  if (expected && (value.caseId !== expected.caseId || value.phase !== expected.phase)) {
    return { ok: false, reason: 'invalid_output' };
  }
  const ids = new Set();
  for (const finding of value.findings) {
    const location = typeof finding?.line === 'number' && Number.isInteger(finding.line) && finding.line > 0
      || typeof finding?.symbol === 'string' && finding.symbol.length > 0;
    const valid = finding && typeof finding === 'object' && typeof finding.id === 'string'
      && !ids.has(finding.id) && STATUSES.has(finding.status) && SEVERITIES.has(finding.severity)
      && typeof finding.file === 'string' && finding.file.length > 0
      && typeof finding.summary === 'string' && typeof finding.contract === 'string'
      && typeof finding.evidence === 'string' && finding.evidence.length > 0
      && typeof finding.impact === 'string' && typeof finding.correctionDirection === 'string'
      && (finding.status !== 'confirmed' || location);
    if (!valid) return { ok: false, reason: 'invalid_output' };
    ids.add(finding.id);
  }
  return { ok: true, value };
}
