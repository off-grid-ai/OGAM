import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeRegExp, literalPattern } from '../device-journey.mjs';

test('a flag with pattern characters matches only its own text', () => {
  const pattern = literalPattern('LFM2.5 (8B)');
  assert.equal(pattern.test('Liquid lfm2.5 (8b) GGUF'), true);
  assert.equal(pattern.test('LFM2x5 8B'), false);
});

test('a flag that would hang or break a raw RegExp is safe', () => {
  assert.doesNotThrow(() => literalPattern('(a+)+$['));
  assert.equal(literalPattern('(a+)+$[').test('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!'), false);
});

test('a label with backslashes and brackets matches inside an XML attribute', () => {
  const label = 'NPU (Beta) \\ [x]';
  const xml = `<node text="${label}" checked="true" />`;
  assert.equal(new RegExp(`text="${escapeRegExp(label)}"[^>]*checked="true"`).test(xml), true);
  assert.equal(new RegExp(`text="${escapeRegExp('NPU (Beta)')}"[^>]*checked="true"`).test(xml), false);
});
