import test from 'node:test'; import assert from 'node:assert/strict'; import { normalizeCount } from './count.mjs';
test('does not return negative counts', () => assert.equal(normalizeCount(-3.8), 0));
