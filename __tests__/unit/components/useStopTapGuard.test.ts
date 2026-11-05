import { act, renderHook } from '@testing-library/react-native';
import { STOP_TAP_GRACE_MS, useStopTapGuard } from '../../../src/components/ChatInput/useStopTapGuard';

const { generationSession } = require('../../../src/services/generationSession');

type Props = { generating: boolean };

describe('useStopTapGuard (a late Stop tap lands on the mic)', () => {
  beforeEach(() => { jest.useFakeTimers(); generationSession._reset(); });
  afterEach(() => jest.useRealTimers());

  it('the mic rests and ignores a tap just after the reply ended', () => {
    const start = jest.fn();
    const hook = renderHook<ReturnType<typeof useStopTapGuard>, Props>(({ generating }) => useStopTapGuard(generating, start), { initialProps: { generating: true } });
    hook.rerender({ generating: false });
    expect(hook.result.current.resting).toBe(true);
    hook.result.current.start();
    expect(start).not.toHaveBeenCalled();
  });

  it('the mic wakes once the grace has passed', () => {
    const start = jest.fn();
    const hook = renderHook<ReturnType<typeof useStopTapGuard>, Props>(({ generating }) => useStopTapGuard(generating, start), { initialProps: { generating: true } });
    hook.rerender({ generating: false });
    act(() => { jest.advanceTimersByTime(STOP_TAP_GRACE_MS + 1); });
    expect(hook.result.current.resting).toBe(false);
    hook.result.current.start();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('a mic with no reply just ended is awake', () => {
    const start = jest.fn();
    const hook = renderHook(() => useStopTapGuard(false, start));
    expect(hook.result.current.resting).toBe(false);
    hook.result.current.start();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('a composer mounted just after the turn ended still rests (hand test 19)', () => {
    generationSession.begin('c1');
    generationSession.end('done');
    const start = jest.fn();
    const hook = renderHook(() => useStopTapGuard(false, start));
    expect(hook.result.current.resting).toBe(true);
    hook.result.current.start();
    expect(start).not.toHaveBeenCalled();
  });
});
