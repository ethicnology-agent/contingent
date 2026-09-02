export function normalizeCount(value) { return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0; }
