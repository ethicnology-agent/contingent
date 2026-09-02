export function sortLabels(labels) { return [...labels].sort((a, b) => (b.length - a.length) || (a < b ? 1 : a > b ? -1 : 0)); }
