import test from 'node:test'; import assert from 'node:assert/strict'; import { normalizeScore } from './score.mjs';
test('caps scores at the contract maximum', () => assert.equal(normalizeScore(120), 100));
