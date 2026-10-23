/**
 * The spec's value rules (docs/ANALYTICS.md, "Shared value rules"): pure functions, checked as
 * input → output tables.
 */
import {
  batteryPct,
  bytesToGb,
  computeBackend,
  contextBucket,
  errorCode,
  fileExtension,
  ignore,
  languageOnly,
  modelRef,
  ms,
  oneDecimal,
  releaseChannel,
  sizeBucket,
  toolFeature,
} from '../../../src/services/analytics/values';

const GB = 1024 * 1024 * 1024;

describe('analytics value rules', () => {
  it.each([
    ['owner/repo/file.gguf', undefined, 'owner/repo'],
    ['anything', 'unsloth/Qwen3-GGUF', 'unsloth/Qwen3-GGUF'],
    ['m', 'unsloth/Qwen3-GGUF/sub/path', 'unsloth/Qwen3-GGUF'],
    ['local_import/my secret notes.gguf', undefined, 'custom'],
    ['local_my_zip_123', undefined, 'custom'],
    ['recovered_family.gguf', undefined, 'custom'],
    ['anythingv5_cpu', undefined, 'anythingv5_cpu'],
    ['image:anythingv5_cpu', undefined, 'anythingv5_cpu'],
    ['image:local_my_zip_123', undefined, 'custom'],
    ['has spaces in it', undefined, 'custom'],
    [null, undefined, 'custom'],
    [undefined, 'not a repo', 'custom'],
  ])('model %p (origin %p) is sent as %p', (id, repo, expected) => {
    expect(modelRef(id as string | null | undefined, repo)).toBe(expected);
  });

  it.each([
    [undefined, undefined],
    [0, undefined],
    [0.5 * GB, '<1GB'],
    [1.5 * GB, '1-2GB'],
    [3 * GB, '2-4GB'],
    [6 * GB, '4-8GB'],
    [9 * GB, '>8GB'],
  ])('size %p is bucketed as %p', (bytes, bucket) => {
    expect(sizeBucket(bytes)).toBe(bucket);
  });

  it.each([
    [undefined, undefined],
    [0, undefined],
    [1000, '<2k'],
    [4000, '2-8k'],
    [16000, '8-32k'],
    [64000, '>32k'],
  ])('context of %p tokens is bucketed as %p', (tokens, bucket) => {
    expect(contextBucket(tokens)).toBe(bucket);
  });

  it('rounds durations, rates, sizes and battery as the spec says', () => {
    expect(ms(12.6)).toBe(13);
    expect(ms(undefined)).toBeUndefined();
    expect(ms(Number.NaN)).toBeUndefined();
    expect(oneDecimal(12.34)).toBe(12.3);
    expect(oneDecimal(null)).toBeUndefined();
    expect(bytesToGb(1.26 * GB)).toBe(1.3);
    expect(bytesToGb(undefined)).toBeUndefined();
    expect(batteryPct(0.64)).toBe(60);
    expect(batteryPct(-1)).toBeUndefined();
    expect(batteryPct(undefined)).toBeUndefined();
  });

  it('error codes come from our error classes, never a message', () => {
    expect(errorCode(Object.assign(new Error('Not enough space for /Users/me/x'), { code: 'disk_full' }))).toBe('disk_full');
    class OverridableMemoryError extends Error {
      name = 'OverridableMemoryError';
    }
    expect(errorCode(new OverridableMemoryError('my private prompt'))).toBe('OverridableMemoryError');
    expect(errorCode(new Error('my private prompt'))).toBe('error');
    expect(errorCode({ code: 'has spaces: and text' })).toBe('error');
    expect(errorCode('a raw message')).toBe('error');
    expect(errorCode(undefined)).toBe('error');
  });

  it('keeps the language only, the channel, the extension and the feature', () => {
    expect(languageOnly('en-GB')).toBe('en');
    expect(languageOnly('pt_BR')).toBe('pt');
    expect(languageOnly(undefined)).toBe('unknown');
    expect(releaseChannel('0.0.117')).toBe('stable');
    expect(releaseChannel('0.0.117-beta.1')).toBe('nightly');
    expect(fileExtension('Quarterly Plan.PDF')).toBe('pdf');
    expect(fileExtension('no-extension')).toBeUndefined();
    expect(fileExtension(undefined)).toBeUndefined();
    expect(toolFeature('web_search')).toBe('web_search');
    expect(toolFeature('read_url')).toBe('web_search');
    expect(toolFeature('clipboard_read')).toBe('clipboard');
    expect(toolFeature('browser_open')).toBe('browser_action');
    expect(toolFeature('calculator')).toBe('tools');
  });

  it.each([
    ['htp', 'npu'], ['npu', 'npu'], ['qnn', 'npu'],
    ['metal', 'gpu'], ['opencl', 'gpu'], ['gpu', 'gpu'], ['coreml', 'gpu'],
    ['cpu', 'cpu'], ['mnn', 'cpu'], [undefined, 'cpu'],
  ])('backend setting %p is %p', (setting, backend) => {
    expect(computeBackend(setting)).toBe(backend);
  });

  it('a dropped failure resolves to nothing', () => {
    expect(ignore()).toBeUndefined();
  });
});
