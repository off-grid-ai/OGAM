/**
 * Crash report scrubbing (docs/ANALYTICS.md, Crashes): a path keeps only an app code file name,
 * a person's file becomes `<file>`, quoted text, URLs and IP addresses are dropped, and anything
 * after a colon goes. Type, file, line and function stay.
 */
import { fileName, scrubExceptionProperties, scrubMessage } from '../../../src/services/analytics/scrub';

describe('crash report scrubbing', () => {
  it.each([
    ['Cannot read /var/mobile/Containers/Data/notes/secret.txt', 'Cannot read <file>'],
    ['Bad token in /data/app/index.android.bundle', 'Bad token in index.android.bundle'],
    ['Could not open Taxes2025.pdf now', 'Could not open <file> now'],
    ['Failed to load qwen-private-finetune.gguf', 'Failed to load <file>'],
    ['Failed to parse "my diary entry" here', 'Failed to parse here'],
    ["TypeError: undefined is not a function", 'TypeError'],
    ['fetch https://my.server.lan/v1/chat?q=private failed', 'fetch failed'],
    ['connect 192.168.1.20:8080 refused', 'connect refused'],
    ['Plain message', 'Plain message'],
  ])('%p → %p', (raw, clean) => {
    expect(scrubMessage(raw)).toBe(clean);
  });

  it('only scrubs text', () => {
    expect(scrubMessage(undefined)).toBeUndefined();
    expect(fileName('/a/b/c.js?x=1#y')).toBe('c.js');
    expect(fileName('C:\\Users\\me\\app.js')).toBe('app.js');
    expect(fileName('')).toBeUndefined();
    expect(fileName('/a/b/')).toBeUndefined();
    expect(fileName(42)).toBeUndefined();
  });

  it('keeps type, file name, line and function, and drops every other $exception property', () => {
    const scrubbed = scrubExceptionProperties({
      platform: 'android',
      $exception_level: 'fatal',
      $exception_message: 'raw "secret" text',
      $exception_steps: [{ message: 'typed something' }],
      $exception_list: [
        {
          type: 'Error',
          value: 'Could not open "/Users/me/Taxes 2025.pdf": denied',
          mechanism: { handled: false },
          stacktrace: {
            type: 'raw',
            frames: [
              {
                platform: 'hermes',
                abs_path: '/data/app/index.android.bundle',
                function: 'openFile',
                lineno: 12,
                colno: 4,
                in_app: true,
                context_line: 'const secret = "x"',
                vars: { prompt: 'hello' },
              },
            ],
          },
        },
        { type: 'TypeError', value: 'x is undefined' },
      ],
    });
    expect(scrubbed).toEqual({
      platform: 'android',
      $exception_level: 'fatal',
      $exception_list: [
        {
          type: 'Error',
          value: 'Could not open',
          mechanism: { handled: false },
          stacktrace: {
            type: 'raw',
            frames: [
              { platform: 'hermes', filename: 'index.android.bundle', function: 'openFile', lineno: 12, colno: 4, in_app: true },
            ],
          },
        },
        { type: 'TypeError', value: 'x is undefined', mechanism: undefined },
      ],
    });
  });

  it('a frame list without a type is still raw, and no list stays absent', () => {
    expect(
      scrubExceptionProperties({ $exception_list: [{ type: 'E', stacktrace: { frames: [{ filename: 'a/b.js' }] } }] }),
    ).toEqual({
      $exception_list: [
        {
          type: 'E',
          value: undefined,
          mechanism: undefined,
          stacktrace: { type: 'raw', frames: [{ platform: undefined, filename: 'b.js', function: undefined, lineno: undefined, colno: undefined, in_app: undefined }] },
        },
      ],
    });
    expect(scrubExceptionProperties({ a: 1 })).toEqual({ a: 1 });
  });
});
