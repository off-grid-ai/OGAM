/**
 * Unit tests for modelReadiness — the single source of truth for mapping a load
 * failure to a typed reason and a reason to user-facing alert copy.
 */
import { reasonFromLoadError, modelNotReadyAlert } from '../../../src/screens/ChatScreen/modelReadiness';

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
