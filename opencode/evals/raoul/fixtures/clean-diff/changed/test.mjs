import test from 'node:test'; import assert from 'node:assert/strict'; import { formatTitle } from './title.mjs';
test('normalizes whitespace without changing case', () => assert.equal(formatTitle('  API Review  '), 'API Review'));
