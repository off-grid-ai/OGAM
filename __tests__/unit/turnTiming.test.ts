import { describeTurn, nextTimes } from '../../src/atlasVoice/turnTiming';

describe('call turn timing', () => {
  it('reports the two stages once the voice has started', () => {
    let t = nextTimes({}, 'stopped', 1000);
    expect(describeTurn(t)).toBeNull();
    t = nextTimes(t, 'sent', 1800);
    t = nextTimes(t, 'voice', 5000);
    expect(describeTurn(t)).toBe('Last turn: sent 0.8 s after you stopped, voice started 3.2 s later');
  });

  it('counts each stage once, in order, and starts again on a new turn', () => {
    expect(nextTimes({}, 'sent', 5)).toEqual({});
    expect(nextTimes({}, 'voice', 5)).toEqual({});
    const t = nextTimes(nextTimes({ stoppedAt: 1 }, 'sent', 2), 'sent', 9);
    expect(t.sentAt).toBe(2);
    expect(nextTimes(t, 'stopped', 50)).toEqual({ stoppedAt: 50 });
  });
});
