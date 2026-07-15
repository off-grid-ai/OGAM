/**
 * loadPolicySync — the single projection of the persisted model-loading setting
 * onto the residency manager's runtime policy.
 *
 * Drives the REAL appStore and the REAL modelResidencyManager (the thing under
 * test is not mocked) so a green test means the projection actually works end to
 * end: flip the setting → the manager's policy changes.
 *
 * The setting resolves through ONE mapping (loadPolicyFromSettings): the explicit
 * 3-mode `modelLoadingMode` selector wins; the legacy `aggressiveModelLoading`
 * boolean is the fallback (aggressive↔balanced) for pre-migration installs. The
 * sync diffs on the RESULTING LoadPolicy, so setLoadPolicy runs only when the
 * effective policy actually changes.
 */
import { loadPolicyFromSettings, startLoadPolicySync } from '../../../src/services/loadPolicySync';
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { useAppStore } from '../../../src/stores';

describe('loadPolicyFromSettings (the one setting→policy mapping)', () => {
  it('prefers the explicit 3-mode setting when present', () => {
    expect(loadPolicyFromSettings({ modelLoadingMode: 'conservative' })).toBe('conservative');
    expect(loadPolicyFromSettings({ modelLoadingMode: 'balanced' })).toBe('balanced');
    expect(loadPolicyFromSettings({ modelLoadingMode: 'aggressive' })).toBe('aggressive');
  });

  it('falls back to the legacy boolean when no explicit mode is set', () => {
    expect(loadPolicyFromSettings({ aggressiveModelLoading: true })).toBe('aggressive');
    expect(loadPolicyFromSettings({ aggressiveModelLoading: false })).toBe('balanced');
    expect(loadPolicyFromSettings({})).toBe('balanced');
  });

  it('the explicit mode wins even when the legacy boolean disagrees', () => {
    expect(
      loadPolicyFromSettings({ modelLoadingMode: 'conservative', aggressiveModelLoading: true }),
    ).toBe('conservative');
  });
});

describe('startLoadPolicySync', () => {
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    // Start from an explicit balanced mode with the legacy boolean off, so each test
    // sets the driver it means to exercise.
    useAppStore.getState().updateSettings({
      modelLoadingMode: 'balanced',
      aggressiveModelLoading: false,
    });
    modelResidencyManager.setLoadPolicy('balanced');
  });
  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
    modelResidencyManager.setLoadPolicy('balanced');
  });

  it('seeds the manager from the current (hydrated) setting on start', () => {
    useAppStore.getState().updateSettings({ modelLoadingMode: 'aggressive' });
    modelResidencyManager.setLoadPolicy('balanced'); // simulate a fresh manager
    unsubscribe = startLoadPolicySync();
    expect(modelResidencyManager.getLoadPolicy()).toBe('aggressive');
  });

  it('projects a later mode change onto the manager (View dispatches intent, service owns state)', () => {
    unsubscribe = startLoadPolicySync();
    expect(modelResidencyManager.getLoadPolicy()).toBe('balanced');

    useAppStore.getState().updateSettings({ modelLoadingMode: 'aggressive' });
    expect(modelResidencyManager.getLoadPolicy()).toBe('aggressive');

    useAppStore.getState().updateSettings({ modelLoadingMode: 'conservative' });
    expect(modelResidencyManager.getLoadPolicy()).toBe('conservative');

    useAppStore.getState().updateSettings({ modelLoadingMode: 'balanced' });
    expect(modelResidencyManager.getLoadPolicy()).toBe('balanced');
  });

  it('the legacy boolean still drives the manager (aggressive↔balanced) when no explicit mode is set', () => {
    // Clear the explicit mode so the boolean is the effective driver (pre-migration install).
    useAppStore.getState().updateSettings({ modelLoadingMode: undefined });
    unsubscribe = startLoadPolicySync();
    expect(modelResidencyManager.getLoadPolicy()).toBe('balanced');

    useAppStore.getState().updateSettings({ aggressiveModelLoading: true });
    expect(modelResidencyManager.getLoadPolicy()).toBe('aggressive');

    useAppStore.getState().updateSettings({ aggressiveModelLoading: false });
    expect(modelResidencyManager.getLoadPolicy()).toBe('balanced');
  });

  it('stops projecting after unsubscribe', () => {
    unsubscribe = startLoadPolicySync();
    unsubscribe();
    unsubscribe = undefined;
    useAppStore.getState().updateSettings({ modelLoadingMode: 'aggressive' });
    // No longer synced → manager keeps its last value.
    expect(modelResidencyManager.getLoadPolicy()).toBe('balanced');
  });

  it('is a singleton — calling twice does NOT stack subscriptions (leak guard)', () => {
    const first = startLoadPolicySync();
    const second = startLoadPolicySync();
    expect(second).toBe(first); // same live unsubscribe returned, not a new subscription
    unsubscribe = first;

    const spy = jest.spyOn(modelResidencyManager, 'setLoadPolicy');
    // One mode change → setLoadPolicy fires exactly once, not once-per-start.
    useAppStore.getState().updateSettings({ modelLoadingMode: 'aggressive' });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('does not fire setLoadPolicy when the resolved policy is unchanged (only on a real policy change)', () => {
    unsubscribe = startLoadPolicySync();
    const spy = jest.spyOn(modelResidencyManager, 'setLoadPolicy');
    // Change unrelated settings — resolved policy stays 'balanced'.
    useAppStore.getState().updateSettings({ temperature: 0.5 });
    useAppStore.getState().updateSettings({ maxTokens: 2048 });
    expect(spy).not.toHaveBeenCalled();
    // Flipping the legacy boolean while modelLoadingMode='balanced' is set does NOT
    // change the resolved policy (the explicit mode wins) → still no setLoadPolicy.
    useAppStore.getState().updateSettings({ aggressiveModelLoading: true });
    expect(spy).not.toHaveBeenCalled();
    // Actually changing the mode DOES fire it, with the resolved policy.
    useAppStore.getState().updateSettings({ modelLoadingMode: 'aggressive' });
    expect(spy).toHaveBeenCalledWith('aggressive');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
