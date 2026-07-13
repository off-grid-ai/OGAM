import { OnDeviceEngineEmitter } from '@offgrid/pro/audio/engine/OnDeviceEngineEmitter';

/**
 * OnDeviceEngineEmitter is pure in-process logic — a typed event emitter with a
 * download-error slot. No native modules, no network, no clock, no
 * AsyncStorage. So there is NOTHING to mock: we drive the REAL emitter and
 * assert the OBSERVABLE outcomes — which listeners actually received which
 * args, in registration order, how often, and the resulting listener counts /
 * download-error state. Both sides of every branch are exercised (event
 * present vs. absent, once fires-then-detaches, off is idempotent, a throwing
 * handler is swallowed so later handlers still run, removeAllListeners with and
 * without a target event, listenerCount with and without a target event, the
 * download error slot set to a string then cleared to null).
 *
 * Deleting the emitter implementation (or inverting any branch) must fail these
 * tests — nothing is asserted via "a function was called" alone.
 */

type Events = {
  data: (n: number) => void;
  other: (s: string) => void;
};

/**
 * Real subclass exposing the protected surface (emit / removeAllListeners /
 * listenerCount / _setDownloadError) exactly as a concrete engine would. This
 * is not a mock — it is a genuine consumer of the base class.
 */
class TestEngine extends OnDeviceEngineEmitter<Events> {
  fire<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    this.emit(event, ...args);
  }
  clearAll(event?: keyof Events): void {
    this.removeAllListeners(event);
  }
  count(event?: keyof Events): number {
    return this.listenerCount(event);
  }
  setDownloadError(message: string | null): void {
    this._setDownloadError(message);
  }
}

describe('OnDeviceEngineEmitter', () => {
  let engine: TestEngine;

  beforeEach(() => {
    engine = new TestEngine();
  });

  describe('on / emit', () => {
    it('delivers emitted args to a subscribed listener', () => {
      const received: number[] = [];
      engine.on('data', (n) => received.push(n));

      engine.fire('data', 7);
      engine.fire('data', 42);

      expect(received).toEqual([7, 42]);
    });

    it('delivers to multiple listeners of the same event in registration order', () => {
      const order: string[] = [];
      engine.on('data', () => order.push('first'));
      engine.on('data', () => order.push('second'));

      engine.fire('data', 1);

      expect(order).toEqual(['first', 'second']);
    });

    it('isolates listeners by event key — other-event listeners do not fire', () => {
      const dataSeen: number[] = [];
      const otherSeen: string[] = [];
      engine.on('data', (n) => dataSeen.push(n));
      engine.on('other', (s) => otherSeen.push(s));

      engine.fire('data', 5);

      expect(dataSeen).toEqual([5]);
      expect(otherSeen).toEqual([]);
    });

    it('emit for an event with NO listeners is a no-op (early return branch)', () => {
      // Nothing subscribed to 'other'; must not throw and must not touch 'data'.
      const dataSeen: number[] = [];
      engine.on('data', (n) => dataSeen.push(n));

      expect(() => engine.fire('other', 'x')).not.toThrow();
      expect(dataSeen).toEqual([]);
    });

    it('creates a fresh listener Set on first subscribe and reuses it on second', () => {
      // First subscribe hits the `!has(key)` true branch; second hits false.
      engine.on('data', () => {});
      expect(engine.count('data')).toBe(1);
      engine.on('data', () => {});
      expect(engine.count('data')).toBe(2);
    });

    it('swallows a throwing handler so later handlers still receive the event', () => {
      const seen: string[] = [];
      engine.on('data', () => {
        seen.push('before');
        throw new Error('boom');
      });
      engine.on('data', () => seen.push('after'));

      expect(() => engine.fire('data', 1)).not.toThrow();
      expect(seen).toEqual(['before', 'after']);
    });
  });

  describe('off / unsubscribe', () => {
    it('the disposer returned by on() detaches the listener', () => {
      const seen: number[] = [];
      const dispose = engine.on('data', (n) => seen.push(n));

      engine.fire('data', 1);
      dispose();
      engine.fire('data', 2);

      expect(seen).toEqual([1]);
    });

    it('off() removes only the named listener, leaving others attached', () => {
      const a: number[] = [];
      const b: number[] = [];
      const la = (n: number) => a.push(n);
      const lb = (n: number) => b.push(n);
      engine.on('data', la);
      engine.on('data', lb);

      engine.off('data', la);
      engine.fire('data', 9);

      expect(a).toEqual([]);
      expect(b).toEqual([9]);
    });

    it('off() for an event that was never subscribed is a safe no-op', () => {
      // Hits the optional-chaining false branch (`.get(...)` is undefined).
      expect(() => engine.off('other', () => {})).not.toThrow();
      expect(engine.count()).toBe(0);
    });
  });

  describe('once', () => {
    it('fires exactly once with the emitted args then detaches', () => {
      const seen: number[] = [];
      engine.once('data', (n) => seen.push(n));

      engine.fire('data', 11);
      engine.fire('data', 22);

      expect(seen).toEqual([11]);
      expect(engine.count('data')).toBe(0);
    });

    it('the disposer returned by once() detaches before it ever fires', () => {
      const seen: number[] = [];
      const dispose = engine.once('data', (n) => seen.push(n));

      dispose();
      engine.fire('data', 1);

      expect(seen).toEqual([]);
      expect(engine.count('data')).toBe(0);
    });
  });

  describe('removeAllListeners', () => {
    it('with an event arg removes only that event, leaving others (true branch)', () => {
      const dataSeen: number[] = [];
      const otherSeen: string[] = [];
      engine.on('data', (n) => dataSeen.push(n));
      engine.on('other', (s) => otherSeen.push(s));

      engine.clearAll('data');
      engine.fire('data', 1);
      engine.fire('other', 'y');

      expect(dataSeen).toEqual([]);
      expect(otherSeen).toEqual(['y']);
      expect(engine.count('data')).toBe(0);
      expect(engine.count('other')).toBe(1);
    });

    it('with no arg clears every listener across all events (false branch)', () => {
      const dataSeen: number[] = [];
      const otherSeen: string[] = [];
      engine.on('data', (n) => dataSeen.push(n));
      engine.on('other', (s) => otherSeen.push(s));

      engine.clearAll();
      engine.fire('data', 1);
      engine.fire('other', 'z');

      expect(dataSeen).toEqual([]);
      expect(otherSeen).toEqual([]);
      expect(engine.count()).toBe(0);
    });
  });

  describe('listenerCount', () => {
    it('with an event arg returns that event count, and 0 for an unknown event (?? branch)', () => {
      engine.on('data', () => {});
      engine.on('data', () => {});

      expect(engine.count('data')).toBe(2);
      // 'other' has no Set → `?.size` undefined → `?? 0`.
      expect(engine.count('other')).toBe(0);
    });

    it('with no arg sums listeners across all events', () => {
      engine.on('data', () => {});
      engine.on('data', () => {});
      engine.on('other', () => {});

      expect(engine.count()).toBe(3);
    });

    it('with no arg on an empty emitter returns 0', () => {
      expect(engine.count()).toBe(0);
    });
  });

  describe('download error slot', () => {
    it('defaults to null before any failure is recorded', () => {
      expect(engine.getLastDownloadError()).toBeNull();
    });

    it('records a failure message then clears it back to null', () => {
      engine.setDownloadError('network down');
      expect(engine.getLastDownloadError()).toBe('network down');

      engine.setDownloadError(null);
      expect(engine.getLastDownloadError()).toBeNull();
    });
  });
});
