import { renderHook } from '@testing-library/react-native';
import { STOP_TAP_GRACE_MS, useStopTapGuard } from '../../../src/components/ChatInput/useStopTapGuard';

describe('useStopTapGuard (a late Stop tap lands on the mic)', () => {
  let clock = 1000;
  const now = () => clock;

  it('ignores a mic tap just after the reply ended', () => {
    const start = jest.fn();
    const hook = renderHook(({ generating }) => useStopTapGuard(generating, start, now), { initialProps: { generating: true } });
    hook.rerender({ generating: false });
    clock += STOP_TAP_GRACE_MS - 100;
    hook.result.current();
    expect(start).not.toHaveBeenCalled();
  });

  it('starts recording once the grace has passed', () => {
    const start = jest.fn();
    const hook = renderHook(({ generating }) => useStopTapGuard(generating, start, now), { initialProps: { generating: true } });
    hook.rerender({ generating: false });
    clock += STOP_TAP_GRACE_MS + 1;
    hook.result.current();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('starts recording at once when no reply just ended', () => {
    const start = jest.fn();
    const hook = renderHook(() => useStopTapGuard(false, start, now));
    hook.result.current();
    expect(start).toHaveBeenCalledTimes(1);
  });
});
