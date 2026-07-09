/**
 * loadPolicySync — the single projection of the persisted "aggressive model
 * loading" setting onto the residency manager's runtime policy.
 *
 * Drives the REAL appStore and the REAL modelResidencyManager (the thing under
 * test is not mocked) so a green test means the projection actually works end to
 * end: flip the setting → the manager's policy changes.
 */
import { loadPolicyFromSettings, startLoadPolicySync } from '../../../src/services/loadPolicySync';
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { useAppStore } from '../../../src/stores';

describe('loadPolicyFromSettings (the one boolean→policy mapping)', () => {
  it('maps the flag to a policy', () => {
    expect(loadPolicyFromSettings({ aggressiveModelLoading: true })).toBe('aggressive');
    expect(loadPolicyFromSettings({ aggressiveModelLoading: false })).toBe('balanced');
    expect(loadPolicyFromSettings({})).toBe('balanced');
  });
});

describe('startLoadPolicySync', () => {
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    useAppStore.getState().updateSettings({ aggressiveModelLoading: false });
    modelResidencyManager.setLoadPolicy('balanced');
  });
  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
    modelResidencyManager.setLoadPolicy('balanced');
  });

  it('seeds the manager from the current (hydrated) setting on start', () => {
    useAppStore.getState().updateSettings({ aggressiveModelLoading: true });
    modelResidencyManager.setLoadPolicy('balanced'); // simulate a fresh manager
    unsubscribe = startLoadPolicySync();
    expect(modelResidencyManager.getLoadPolicy()).toBe('aggressive');
  });

  it('projects a later toggle onto the manager (View dispatches intent, service owns state)', () => {
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
    useAppStore.getState().updateSettings({ aggressiveModelLoading: true });
    // No longer synced → manager keeps its last value.
    expect(modelResidencyManager.getLoadPolicy()).toBe('balanced');
  });

  it('is a singleton — calling twice does NOT stack subscriptions (leak guard)', () => {
    const first = startLoadPolicySync();
    const second = startLoadPolicySync();
    expect(second).toBe(first); // same live unsubscribe returned, not a new subscription
    unsubscribe = first;

    const spy = jest.spyOn(modelResidencyManager, 'setLoadPolicy');
    // One flag flip → setLoadPolicy fires exactly once, not once-per-start.
    useAppStore.getState().updateSettings({ aggressiveModelLoading: true });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('does not fire setLoadPolicy for unrelated setting changes (only on flag flip)', () => {
    unsubscribe = startLoadPolicySync();
    const spy = jest.spyOn(modelResidencyManager, 'setLoadPolicy');
    // Change an unrelated setting several times.
    useAppStore.getState().updateSettings({ temperature: 0.5 });
    useAppStore.getState().updateSettings({ maxTokens: 2048 });
    expect(spy).not.toHaveBeenCalled();
    // Flipping the flag DOES fire it.
    useAppStore.getState().updateSettings({ aggressiveModelLoading: true });
    expect(spy).toHaveBeenCalledWith('aggressive');
    spy.mockRestore();
  });
});
