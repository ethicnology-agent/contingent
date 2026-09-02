import test from 'node:test'; import assert from 'node:assert/strict'; import { sortLabels } from './labels.mjs';
test('keeps the explicitly permitted ordering', () => assert.deepEqual(sortLabels(['aa', 'bbb', 'cc']), ['bbb', 'cc', 'aa']));
