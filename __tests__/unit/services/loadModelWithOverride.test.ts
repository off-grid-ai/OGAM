import { loadModelWithOverride } from '../../../src/services/loadModelWithOverride';
import { OverridableMemoryError } from '../../../src/services/modelLoadErrors';

// Mock only the alert boundary (CustomAlert builds RN alert state); the helper's
// real retry/branch logic runs for real.
jest.mock('../../../src/components/CustomAlert', () => ({
  showAlert: (title: string, message: string, buttons?: any[]) => ({ visible: true, title, message, buttons }),
  hideAlert: () => ({ visible: false, title: '', message: '', buttons: [] }),
}));

const makeDeps = () => ({
  setAlertState: jest.fn(),
  onSuccess: jest.fn(),
  onError: jest.fn(),
  onAttemptStart: jest.fn(),
  onAttemptEnd: jest.fn(),
});

describe('loadModelWithOverride', () => {
  it('calls onSuccess and never alerts when the load succeeds', async () => {
    const load = jest.fn().mockResolvedValue(undefined);
    const deps = makeDeps();
    await loadModelWithOverride(load, deps);
    expect(load).toHaveBeenCalledWith(undefined);
    expect(deps.onSuccess).toHaveBeenCalledTimes(1);
    expect(deps.setAlertState).not.toHaveBeenCalled();
    expect(deps.onAttemptStart).toHaveBeenCalledTimes(1);
    expect(deps.onAttemptEnd).toHaveBeenCalledTimes(1);
  });

  it('offers "Load Anyway" on an OverridableMemoryError, then retries with override:true', async () => {
    const load = jest.fn()
      .mockRejectedValueOnce(new OverridableMemoryError('Not enough free memory'))
      .mockResolvedValueOnce(undefined);
    const deps = makeDeps();

    await loadModelWithOverride(load, deps);

    // Inline "Insufficient Memory" alert with a Load Anyway button (not a dead-end error).
    const alert = deps.setAlertState.mock.calls.at(-1)?.[0];
    expect(alert.title).toBe('Insufficient Memory');
    const loadAnyway = alert.buttons.find((b: any) => b.text === 'Load Anyway');
    expect(loadAnyway).toBeTruthy();

    // Pressing it retries the load WITH override, then succeeds.
    await loadAnyway.onPress();
    expect(load).toHaveBeenNthCalledWith(2, { override: true });
    expect(deps.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('does NOT offer override again when the forced load still fails (hard limit)', async () => {
    const load = jest.fn()
      .mockRejectedValueOnce(new OverridableMemoryError('blocked'))
      .mockRejectedValueOnce(new OverridableMemoryError('still blocked'));
    const deps = makeDeps();

    await loadModelWithOverride(load, deps);
    const loadAnyway = deps.setAlertState.mock.calls.at(-1)?.[0].buttons.find((b: any) => b.text === 'Load Anyway');
    await loadAnyway.onPress();

    // Second failure (override attempt) shows a plain Error, not another Load Anyway.
    const lastAlert = deps.setAlertState.mock.calls.at(-1)?.[0];
    expect(lastAlert.title).toBe('Error');
    expect(deps.onError).toHaveBeenCalledTimes(1);
  });

  it('shows a plain error (no override) for a non-overridable failure', async () => {
    const load = jest.fn().mockRejectedValue(new Error('Model not found'));
    const deps = makeDeps();
    await loadModelWithOverride(load, deps);
    const alert = deps.setAlertState.mock.calls.at(-1)?.[0];
    expect(alert.title).toBe('Error');
    expect(alert.message).toContain('Model not found');
    expect(deps.onError).toHaveBeenCalledTimes(1);
    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it('runs onAttemptStart/End for the retry too', async () => {
    const load = jest.fn()
      .mockRejectedValueOnce(new OverridableMemoryError('blocked'))
      .mockResolvedValueOnce(undefined);
    const deps = makeDeps();
    await loadModelWithOverride(load, deps);
    await deps.setAlertState.mock.calls.at(-1)?.[0].buttons.find((b: any) => b.text === 'Load Anyway').onPress();
    expect(deps.onAttemptStart).toHaveBeenCalledTimes(2);
    expect(deps.onAttemptEnd).toHaveBeenCalledTimes(2);
  });
});
