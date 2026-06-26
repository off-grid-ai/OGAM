/**
 * Stream playback clock — the cumulative base offset shared between the
 * streaming coordinator and the engine tick handler.
 */
import { getStreamBase, setStreamBase, resetStreamBase } from '../../../pro/audio/streamPlaybackClock';

describe('streamPlaybackClock', () => {
  beforeEach(() => resetStreamBase());

  it('starts at 0', () => {
    expect(getStreamBase()).toBe(0);
  });

  it('advances and resets', () => {
    setStreamBase(3.5);
    expect(getStreamBase()).toBe(3.5);
    setStreamBase(7);
    expect(getStreamBase()).toBe(7);
    resetStreamBase();
    expect(getStreamBase()).toBe(0);
  });
});
