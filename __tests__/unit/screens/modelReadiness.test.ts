/**
 * Unit tests for modelReadiness — the single source of truth for mapping a load
 * failure to a typed reason and a reason to user-facing alert copy.
 */
// Native boundaries mocked as dumb flag readers; the REAL ensureModelReady runs.
jest.mock('../../../src/services', () => ({
  llmService: {
    getLoadedModelPath: jest.fn(() => null),
    isModelLoaded: jest.fn(() => false),
  },
}));
jest.mock('../../../src/services/litert', () => ({
  liteRTService: { isModelLoaded: jest.fn(() => false) },
}));

import { reasonFromLoadError, modelNotReadyAlert, ensureModelReady } from '../../../src/screens/ChatScreen/modelReadiness';
import { llmService } from '../../../src/services';

const mockLlm = llmService as unknown as {
  getLoadedModelPath: jest.Mock;
  isModelLoaded: jest.Mock;
};

describe('reasonFromLoadError', () => {
  it('maps "not found" / missing-file errors to not-downloaded', () => {
    expect(reasonFromLoadError(new Error('Model not found'))).toBe('not-downloaded');
    expect(reasonFromLoadError(new Error('ENOENT: no such file'))).toBe('not-downloaded');
    expect(reasonFromLoadError(new Error('mmproj file is missing'))).toBe('not-downloaded');
  });

  it('maps memory/OOM errors to insufficient-memory', () => {
    expect(reasonFromLoadError(new Error('insufficient memory'))).toBe('insufficient-memory');
    expect(reasonFromLoadError(new Error('process killed by jetsam'))).toBe('insufficient-memory');
    expect(reasonFromLoadError(new Error('ran out of memory'))).toBe('insufficient-memory');
  });

  it('falls back to load-threw for anything else', () => {
    expect(reasonFromLoadError(new Error('llama init failed'))).toBe('load-threw');
    expect(reasonFromLoadError('weird string')).toBe('load-threw');
  });
});

describe('modelNotReadyAlert', () => {
  it('gives a distinct title for each reason (no generic dead-end)', () => {
    const titles = (['no-model-selected', 'not-downloaded', 'insufficient-memory', 'load-in-progress', 'load-threw'] as const)
      .map(r => modelNotReadyAlert(r).title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('includes the underlying detail in the load-threw message when present', () => {
    expect(modelNotReadyAlert('load-threw', 'llama init failed').message).toContain('llama init failed');
  });

  it('uses a safe fallback message when no detail is given', () => {
    expect(modelNotReadyAlert('load-threw').message).toBe('The model failed to load. Please try again.');
  });

  it('insufficient-memory prompts the user to close other apps (the kill-apps prompt)', () => {
    const a = modelNotReadyAlert('insufficient-memory');
    expect(a.message).toMatch(/close other apps/i);
  });

  it('insufficient-memory keeps the underlying detail above the close-apps guidance', () => {
    const a = modelNotReadyAlert('insufficient-memory', 'needs ~7GB');
    expect(a.message).toContain('needs ~7GB');
    expect(a.message).toMatch(/close other apps/i);
  });
});

describe('ensureModelReady — resume-after-Load-Anyway wiring (regression)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLlm.getLoadedModelPath.mockReturnValue(null); // nothing loaded → needs a load
    mockLlm.isModelLoaded.mockReturnValue(false);
  });

  const makeDeps = (engine: string | undefined, ensureModelLoaded: any) => ({
    activeModelInfo: { isRemote: false },
    activeModel: { engine, filePath: '/models/gemma-e4b.gguf' },
    activeModelId: 'gemma-e4b',
    ensureModelLoaded,
    setAlertState: jest.fn(),
  });

  // The bug: the llama (GGUF) branch called ensureModelLoaded() with NO argument,
  // dropping onLoadedResume — so after a "Load Anyway" force-load the turn never
  // resumed and the user had to hit resend. Assert the CONSEQUENCE: the resume
  // callback actually fires (not just "ensureModelLoaded was called").
  it('forwards onLoadedResume to the loader on the llama (GGUF) path so the turn resumes', async () => {
    const resume = jest.fn();
    // Simulate the "Load Anyway" loader: it invokes the resume callback it was given.
    const ensureModelLoaded = jest.fn(async (onResume?: () => void) => {
      onResume?.();
      return { ok: false, reason: 'insufficient-memory', alerted: true };
    });

    await ensureModelReady(makeDeps(undefined, ensureModelLoaded), resume);

    // Deleting `onLoadedResume` from the llama branch (the bug) makes this fail:
    // the loader receives undefined and the turn is silently dropped.
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('forwards onLoadedResume on the litert path too (parity)', async () => {
    const resume = jest.fn();
    const ensureModelLoaded = jest.fn(async (onResume?: () => void) => {
      onResume?.();
      return { ok: false, reason: 'insufficient-memory', alerted: true };
    });

    await ensureModelReady(makeDeps('litert', ensureModelLoaded), resume);

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('does not attempt a load (or resume) when the model is already loaded', async () => {
    mockLlm.getLoadedModelPath.mockReturnValue('/models/gemma-e4b.gguf');
    const resume = jest.fn();
    const ensureModelLoaded = jest.fn();

    const outcome = await ensureModelReady(makeDeps(undefined, ensureModelLoaded), resume);

    expect(outcome).toEqual({ ok: true });
    expect(ensureModelLoaded).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });
});
