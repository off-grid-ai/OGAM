import { withTimeout, TimeoutError } from '../../src/utils/withTimeout';
import { startStallWatchdog } from '../../src/services/generationWatchdog';
import { toolTimeoutFor, TOOL_TIMEOUT_MS } from '../../src/services/generationToolLoop';

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('passes the result through when the work finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, 'x')).resolves.toBe(7);
  });
  it('rejects with a readable error when the work never finishes', async () => {
    const p = withTimeout(new Promise(() => undefined), 5000, 'The "write_file" tool');
    jest.advanceTimersByTime(5000);
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
    await expect(p).rejects.toThrow('longer than 5 seconds');
  });
  it('keeps the original error when the work fails first', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom');
  });
});

describe('stall watchdog', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('fires once after the limit with no change', () => {
    const onStall = jest.fn();
    startStallWatchdog({ signature: () => 'same', onStall, limitMs: 60_000, checkEveryMs: 10_000 });
    jest.advanceTimersByTime(50_000);
    expect(onStall).not.toHaveBeenCalled();
    jest.advanceTimersByTime(30_000);
    expect(onStall).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(120_000);
    expect(onStall).toHaveBeenCalledTimes(1);
  });
  it('does not fire while the reply keeps growing', () => {
    const onStall = jest.fn();
    let n = 0;
    startStallWatchdog({ signature: () => String(n), onStall, limitMs: 60_000, checkEveryMs: 10_000 });
    for (let i = 0; i < 20; i++) { n++; jest.advanceTimersByTime(10_000); }
    expect(onStall).not.toHaveBeenCalled();
  });
  it('stops checking once cancelled', () => {
    const onStall = jest.fn();
    const stop = startStallWatchdog({ signature: () => 'same', onStall, limitMs: 30_000, checkEveryMs: 10_000 });
    stop();
    jest.advanceTimersByTime(300_000);
    expect(onStall).not.toHaveBeenCalled();
  });
});

describe('tool timeouts', () => {
  it('gives ordinary tools three minutes and long ones ten', () => {
    expect(toolTimeoutFor('write_file')).toBe(TOOL_TIMEOUT_MS);
    expect(toolTimeoutFor('deep_research')).toBe(10 * 60 * 1000);
  });
});
