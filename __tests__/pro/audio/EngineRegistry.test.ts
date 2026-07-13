import { EngineRegistry } from '@offgrid/pro/audio/engine/EngineRegistry';
import type {
  OnDeviceEngine,
  BaseEngineEvents,
  EnginePhase,
  ModelAsset,
  ModelAssetState,
} from '@offgrid/pro/audio/engine/types';
import type React from 'react';

/**
 * EngineRegistry is pure in-process logic — no native modules, no network, no
 * clock, no AsyncStorage. So there is nothing to mock: we drive the REAL
 * registry against dumb stub engines that record whether their lifecycle hooks
 * (stop / release) actually ran, and assert the registry's observable state
 * (getActiveEngine / getActiveEngineId / getRegisteredIds / has) and the
 * side-effects the registry is responsible for driving on the engines.
 *
 * Deleting the registry logic must fail these tests: they assert outcomes
 * (which instance is active, whether the previous engine was released, whether
 * a released id disappears) not "a method was called on the registry".
 */

/** A dumb, fully real stub engine. Records lifecycle calls; returns plain data. */
class StubEngine implements OnDeviceEngine<BaseEngineEvents> {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities = { streaming: false, peakRamMB: 0 };

  // Observable lifecycle records — the outcome the registry is responsible for.
  stopCalls = 0;
  releaseCalls = 0;
  // Order token so we can assert stop() runs before release().
  lastStopOrder = -1;
  lastReleaseOrder = -1;
  private _releaseImpl: () => Promise<void> = async () => {};

  constructor(id: string, orderCounter?: { n: number }, releaseImpl?: () => Promise<void>) {
    this.id = id;
    this.displayName = id;
    this._orderCounter = orderCounter;
    if (releaseImpl) this._releaseImpl = releaseImpl;
  }
  private _orderCounter?: { n: number };

  stop(): void {
    this.stopCalls += 1;
    if (this._orderCounter) this.lastStopOrder = this._orderCounter.n++;
  }
  async release(): Promise<void> {
    this.releaseCalls += 1;
    if (this._orderCounter) this.lastReleaseOrder = this._orderCounter.n++;
    await this._releaseImpl();
  }

  // ── Remaining interface surface: inert plain-data stubs ──
  getPhase(): EnginePhase { return 'idle'; }
  on() { return () => {}; }
  off() {}
  once() { return () => {}; }
  isSupported(): boolean { return true; }
  async initialize(): Promise<void> {}
  async destroy(): Promise<void> {}
  getRequiredAssets(): ModelAsset[] { return []; }
  async checkAssetStatus(): Promise<ModelAssetState[]> { return []; }
  async downloadAssets(): Promise<void> {}
  async deleteAssets(): Promise<void> {}
  getOverallDownloadProgress(): number { return 0; }
  isFullyDownloaded(): boolean { return false; }
  getLastDownloadError(): string | null { return null; }
  getBridgeComponent(): React.ComponentType | null { return null; }
}

/** An engine WITHOUT a stop() method — to exercise the hasStop(false) branch. */
class NoStopEngine implements OnDeviceEngine<BaseEngineEvents> {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities = { streaming: false, peakRamMB: 0 };
  releaseCalls = 0;

  constructor(id: string) {
    this.id = id;
    this.displayName = id;
  }
  async release(): Promise<void> { this.releaseCalls += 1; }
  // Deliberately no stop().
  getPhase(): EnginePhase { return 'idle'; }
  on() { return () => {}; }
  off() {}
  once() { return () => {}; }
  isSupported(): boolean { return true; }
  async initialize(): Promise<void> {}
  async destroy(): Promise<void> {}
  getRequiredAssets(): ModelAsset[] { return []; }
  async checkAssetStatus(): Promise<ModelAssetState[]> { return []; }
  async downloadAssets(): Promise<void> {}
  async deleteAssets(): Promise<void> {}
  getOverallDownloadProgress(): number { return 0; }
  isFullyDownloaded(): boolean { return false; }
  getLastDownloadError(): string | null { return null; }
  getBridgeComponent(): React.ComponentType | null { return null; }
}

describe('EngineRegistry', () => {
  describe('register / has / getRegisteredIds', () => {
    it('registers a factory and reports it via has() and getRegisteredIds()', () => {
      const reg = new EngineRegistry<StubEngine>();
      expect(reg.has('kokoro')).toBe(false);
      expect(reg.getRegisteredIds()).toEqual([]);

      reg.register('kokoro', () => new StubEngine('kokoro'));

      expect(reg.has('kokoro')).toBe(true);
      expect(reg.has('outetts')).toBe(false);
      expect(reg.getRegisteredIds()).toEqual(['kokoro']);
    });

    it('does not instantiate the engine at register time (lazy)', () => {
      const reg = new EngineRegistry<StubEngine>();
      let created = 0;
      reg.register('kokoro', () => {
        created += 1;
        return new StubEngine('kokoro');
      });
      expect(created).toBe(0);
    });
  });

  describe('getEngine', () => {
    it('lazily creates the instance on first access and caches it (singleton)', () => {
      const reg = new EngineRegistry<StubEngine>();
      let created = 0;
      reg.register('kokoro', () => {
        created += 1;
        return new StubEngine('kokoro');
      });

      const first = reg.getEngine('kokoro');
      expect(created).toBe(1);
      const second = reg.getEngine('kokoro');
      expect(created).toBe(1); // not created again
      expect(second).toBe(first); // same instance
    });

    it('throws for an unregistered id (the factory-missing branch)', () => {
      const reg = new EngineRegistry<StubEngine>();
      expect(() => reg.getEngine('nope')).toThrow("Engine 'nope' is not registered.");
    });
  });

  describe('setActiveEngine', () => {
    it('sets the active engine and returns the resolved instance', async () => {
      const reg = new EngineRegistry<StubEngine>();
      reg.register('kokoro', () => new StubEngine('kokoro'));

      expect(reg.getActiveEngine()).toBeNull();
      expect(reg.getActiveEngineId()).toBeNull();

      const active = await reg.setActiveEngine('kokoro');

      expect(reg.getActiveEngineId()).toBe('kokoro');
      expect(reg.getActiveEngine()).toBe(active);
      // No previous engine → nothing was released.
      expect(active.releaseCalls).toBe(0);
      expect(active.stopCalls).toBe(0);
    });

    it('stops AND releases the previous engine when switching, in that order', async () => {
      const order = { n: 0 };
      const reg = new EngineRegistry<StubEngine>();
      const kokoro = new StubEngine('kokoro', order);
      const oute = new StubEngine('outetts', order);
      reg.register('kokoro', () => kokoro);
      reg.register('outetts', () => oute);

      await reg.setActiveEngine('kokoro');
      await reg.setActiveEngine('outetts');

      // Previous (kokoro) got stopped then released.
      expect(kokoro.stopCalls).toBe(1);
      expect(kokoro.releaseCalls).toBe(1);
      expect(kokoro.lastStopOrder).toBeLessThan(kokoro.lastReleaseOrder);
      // New active (outetts) untouched, and is the active one.
      expect(oute.stopCalls).toBe(0);
      expect(oute.releaseCalls).toBe(0);
      expect(reg.getActiveEngineId()).toBe('outetts');
      expect(reg.getActiveEngine()).toBe(oute);
    });

    it('does NOT release when re-selecting the SAME active engine', async () => {
      const reg = new EngineRegistry<StubEngine>();
      const kokoro = new StubEngine('kokoro');
      reg.register('kokoro', () => kokoro);

      await reg.setActiveEngine('kokoro');
      await reg.setActiveEngine('kokoro');

      expect(kokoro.stopCalls).toBe(0);
      expect(kokoro.releaseCalls).toBe(0);
      expect(reg.getActiveEngineId()).toBe('kokoro');
    });

    it('throws for a bad id WITHOUT mutating active state', async () => {
      const reg = new EngineRegistry<StubEngine>();
      const kokoro = new StubEngine('kokoro');
      reg.register('kokoro', () => kokoro);
      await reg.setActiveEngine('kokoro');

      await expect(reg.setActiveEngine('nope')).rejects.toThrow(
        "Engine 'nope' is not registered.",
      );
      // Active state unchanged; previous engine NOT torn down.
      expect(reg.getActiveEngineId()).toBe('kokoro');
      expect(kokoro.releaseCalls).toBe(0);
      expect(kokoro.stopCalls).toBe(0);
    });

    it('swallows a throwing previous-engine release and still activates the new one', async () => {
      const reg = new EngineRegistry<StubEngine>();
      const bad = new StubEngine('bad', undefined, async () => {
        throw new Error('release blew up');
      });
      const good = new StubEngine('good');
      reg.register('bad', () => bad);
      reg.register('good', () => good);

      await reg.setActiveEngine('bad');
      // Should not reject despite bad.release() throwing (catch branch).
      await expect(reg.setActiveEngine('good')).resolves.toBe(good);
      expect(reg.getActiveEngineId()).toBe('good');
      expect(bad.releaseCalls).toBe(1); // it was attempted
    });

    it('does not throw stopping a previous engine that lacks stop()', async () => {
      const reg = new EngineRegistry<NoStopEngine | StubEngine>();
      const nostop = new NoStopEngine('nostop');
      const other = new StubEngine('other');
      reg.register('nostop', () => nostop);
      reg.register('other', () => other);

      await reg.setActiveEngine('nostop');
      await reg.setActiveEngine('other');

      // Released without a stop() (hasStop === false branch), and new active set.
      expect(nostop.releaseCalls).toBe(1);
      expect(reg.getActiveEngineId()).toBe('other');
    });

  });

  describe('getActiveEngine', () => {
    it('returns null when no active id is set', () => {
      const reg = new EngineRegistry<StubEngine>();
      expect(reg.getActiveEngine()).toBeNull();
    });

    it('returns null when active id is set but instance is missing (?? branch)', async () => {
      const reg = new EngineRegistry<StubEngine>();
      reg.register('kokoro', () => new StubEngine('kokoro'));
      await reg.setActiveEngine('kokoro');
      // Unregister removes the instance AND clears active because ids match.
      await reg.unregister('kokoro');
      expect(reg.getActiveEngine()).toBeNull();
    });
  });

  describe('unregister', () => {
    it('stops, releases, and removes an instantiated engine and clears active if it was active', async () => {
      const reg = new EngineRegistry<StubEngine>();
      const kokoro = new StubEngine('kokoro');
      reg.register('kokoro', () => kokoro);
      await reg.setActiveEngine('kokoro');

      await reg.unregister('kokoro');

      expect(kokoro.stopCalls).toBe(1);
      expect(kokoro.releaseCalls).toBe(1);
      expect(reg.has('kokoro')).toBe(false);
      expect(reg.getRegisteredIds()).toEqual([]);
      expect(reg.getActiveEngineId()).toBeNull();
    });

    it('releases an engine that lacks stop() without throwing (hasStop=false in unregister)', async () => {
      const reg = new EngineRegistry<NoStopEngine>();
      const nostop = new NoStopEngine('nostop');
      reg.register('nostop', () => nostop);
      reg.getEngine('nostop'); // instantiate so unregister has an instance

      await reg.unregister('nostop');

      expect(nostop.releaseCalls).toBe(1);
      expect(reg.has('nostop')).toBe(false);
    });

    it('removes a registered-but-never-instantiated engine without releasing (no instance branch)', async () => {
      const reg = new EngineRegistry<StubEngine>();
      let created = 0;
      reg.register('kokoro', () => {
        created += 1;
        return new StubEngine('kokoro');
      });

      await reg.unregister('kokoro');

      expect(created).toBe(0); // never instantiated → nothing to release
      expect(reg.has('kokoro')).toBe(false);
    });

    it('does NOT clear active when unregistering a different (non-active) engine', async () => {
      const reg = new EngineRegistry<StubEngine>();
      const kokoro = new StubEngine('kokoro');
      const oute = new StubEngine('outetts');
      reg.register('kokoro', () => kokoro);
      reg.register('outetts', () => oute);
      await reg.setActiveEngine('kokoro');
      // Instantiate oute so it has an instance to release.
      reg.getEngine('outetts');

      await reg.unregister('outetts');

      expect(oute.releaseCalls).toBe(1);
      expect(reg.getActiveEngineId()).toBe('kokoro'); // active untouched
      expect(reg.has('kokoro')).toBe(true);
    });
  });

  describe('releaseAll', () => {
    it('stops and releases every instantiated engine and resets active + instances', async () => {
      const reg = new EngineRegistry<StubEngine>();
      const a = new StubEngine('a');
      const b = new StubEngine('b');
      reg.register('a', () => a);
      reg.register('b', () => b);
      reg.getEngine('a');
      reg.getEngine('b');
      await reg.setActiveEngine('a');

      await reg.releaseAll();

      expect(a.stopCalls).toBe(1);
      expect(a.releaseCalls).toBe(1);
      expect(b.stopCalls).toBe(1);
      expect(b.releaseCalls).toBe(1);
      expect(reg.getActiveEngine()).toBeNull();
      expect(reg.getActiveEngineId()).toBeNull();
    });

    it('clears the instance cache so getEngine rebuilds a FRESH instance after releaseAll', async () => {
      const reg = new EngineRegistry<StubEngine>();
      // A factory that mints a NEW instance every call so we can prove the cache cleared.
      reg.register('a', () => new StubEngine('a'));

      const first = reg.getEngine('a');
      expect(reg.getEngine('a')).toBe(first); // cached before releaseAll

      await reg.releaseAll();

      const rebuilt = reg.getEngine('a');
      expect(rebuilt).not.toBe(first); // instances map was cleared
      expect(first.releaseCalls).toBe(1); // the old instance was released
    });

    it('continues past a throwing release (catch branch) and clears state', async () => {
      const reg = new EngineRegistry<StubEngine>();
      const bad = new StubEngine('bad', undefined, async () => {
        throw new Error('boom');
      });
      const good = new StubEngine('good');
      reg.register('bad', () => bad);
      reg.register('good', () => good);
      reg.getEngine('bad');
      reg.getEngine('good');

      await expect(reg.releaseAll()).resolves.toBeUndefined();

      // good still got released despite bad throwing.
      expect(good.releaseCalls).toBe(1);
      expect(reg.getActiveEngineId()).toBeNull();
    });

    it('releases a no-stop engine during releaseAll without throwing (hasStop=false)', async () => {
      const reg = new EngineRegistry<NoStopEngine>();
      const nostop = new NoStopEngine('nostop');
      reg.register('nostop', () => nostop);
      reg.getEngine('nostop');

      await reg.releaseAll();

      expect(nostop.releaseCalls).toBe(1);
      expect(reg.getActiveEngineId()).toBeNull();
    });

    it('is a no-op when nothing was instantiated', async () => {
      const reg = new EngineRegistry<StubEngine>();
      reg.register('a', () => new StubEngine('a'));
      await expect(reg.releaseAll()).resolves.toBeUndefined();
      expect(reg.getActiveEngineId()).toBeNull();
    });
  });

  describe('integration: full switch lifecycle across real registry state', () => {
    it('activate A → activate B tears down A while B stays live and active resolves consistently', async () => {
      const order = { n: 0 };
      const reg = new EngineRegistry<StubEngine>();
      const a = new StubEngine('a', order);
      const b = new StubEngine('b', order);
      reg.register('a', () => a);
      reg.register('b', () => b);

      const activeA = await reg.setActiveEngine('a');
      expect(activeA).toBe(a);
      expect(reg.getActiveEngine()).toBe(a);

      const activeB = await reg.setActiveEngine('b');
      expect(activeB).toBe(b);
      // A torn down exactly once, stop-before-release, B intact.
      expect(a.stopCalls).toBe(1);
      expect(a.releaseCalls).toBe(1);
      expect(a.lastStopOrder).toBeLessThan(a.lastReleaseOrder);
      expect(b.stopCalls).toBe(0);
      expect(b.releaseCalls).toBe(0);
      expect(reg.getActiveEngine()).toBe(b);
      expect(reg.getActiveEngineId()).toBe('b');

      // releaseAll then re-activate A yields clean active state.
      await reg.releaseAll();
      expect(reg.getActiveEngine()).toBeNull();
      const reactivatedA = await reg.setActiveEngine('a');
      expect(reactivatedA).toBe(a); // this registry's factory returns the same stub
      expect(reg.getActiveEngineId()).toBe('a');
    });
  });
});
