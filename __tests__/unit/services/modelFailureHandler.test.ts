/**
 * modelFailureHandler — the single owner that turns any model failure into a
 * uniform, dismissible card via modelFailureStore. These lock in the contract the
 * UI depends on: severity, memory-pressure detection (→ Retry affordance), the
 * one-card-per-type replace rule, and that nothing is silent.
 */
import { reportModelFailure, clearModelFailure } from '../../../src/services/modelFailureHandler';
import { useModelFailureStore } from '../../../src/stores/modelFailureStore';

describe('reportModelFailure', () => {
  beforeEach(() => useModelFailureStore.getState().clear());

  it('reports a hard error (default severity) with derived copy', () => {
    reportModelFailure('image', new Error('Pipeline failed'));
    const f = useModelFailureStore.getState().failures[0];
    expect(f.modelType).toBe('image');
    expect(f.severity).toBe('error');
    expect(f.memoryPressure).toBe(false);
    expect(f.title).toContain('Image model');
  });

  it('flags memory pressure from the error text and keeps a retry handler', () => {
    const onRetry = jest.fn();
    const f = reportModelFailure('image', new Error('mmap failed: Cannot allocate memory'), { onRetry });
    expect(f.memoryPressure).toBe(true);
    expect(f.onRetry).toBe(onRetry);
  });

  it('does NOT attach a retry handler to a soft warning', () => {
    const onRetry = jest.fn();
    const f = reportModelFailure('text', 'no text model is selected', {
      severity: 'warning',
      title: 'Prompt enhancement skipped',
      message: 'Generating from your original prompt.',
      onRetry,
    });
    expect(f.severity).toBe('warning');
    expect(f.onRetry).toBeUndefined();
    expect(f.title).toBe('Prompt enhancement skipped');
  });

  it('keeps ONE card per model type (replaces, never stacks)', () => {
    reportModelFailure('image', new Error('first'));
    reportModelFailure('image', new Error('second'));
    const { failures } = useModelFailureStore.getState();
    expect(failures.filter(f => f.modelType === 'image')).toHaveLength(1);
    expect(failures[0].message).toContain('second');
  });

  it('lets different model types coexist as separate cards', () => {
    reportModelFailure('image', new Error('image boom'));
    reportModelFailure('tts', new Error('voice boom'), { severity: 'warning', message: 'x' });
    expect(useModelFailureStore.getState().failures).toHaveLength(2);
  });

  it('clearModelFailure dismisses by type', () => {
    reportModelFailure('stt', new Error('boom'));
    clearModelFailure('stt');
    expect(useModelFailureStore.getState().failures).toHaveLength(0);
  });
});
