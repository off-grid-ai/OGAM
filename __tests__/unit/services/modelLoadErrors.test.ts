import {
  OverridableMemoryError, isOverridableMemoryError,
  ImageModelIncompleteError, isImageModelIncompleteError,
} from '../../../src/services/modelLoadErrors';

describe('OverridableMemoryError', () => {
  it('is a real Error subclass carrying the overridable discriminant', () => {
    const err = new OverridableMemoryError('no room');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OverridableMemoryError);
    expect(err.message).toBe('no room');
    expect(err.name).toBe('OverridableMemoryError');
    expect(err.overridable).toBe(true);
  });

  it('isOverridableMemoryError recognises the class', () => {
    expect(isOverridableMemoryError(new OverridableMemoryError('x'))).toBe(true);
  });

  it('isOverridableMemoryError recognises a duck-typed object (survives async/serialisation boundaries)', () => {
    expect(isOverridableMemoryError({ overridable: true, message: 'x' })).toBe(true);
  });

  it('rejects plain errors and non-errors', () => {
    expect(isOverridableMemoryError(new Error('generic'))).toBe(false);
    expect(isOverridableMemoryError('memory')).toBe(false);
    expect(isOverridableMemoryError(null)).toBe(false);
    expect(isOverridableMemoryError(undefined)).toBe(false);
    expect(isOverridableMemoryError({ overridable: false })).toBe(false);
  });
});

describe('ImageModelIncompleteError', () => {
  it('is a real Error subclass carrying the missing files + discriminant', () => {
    const err = new ImageModelIncompleteError(['pos_emb.bin', 'clip_v2.mnn.weight']);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ImageModelIncompleteError);
    expect(err.name).toBe('ImageModelIncompleteError');
    expect(err.incompleteModel).toBe(true);
    expect(err.missing).toEqual(['pos_emb.bin', 'clip_v2.mnn.weight']);
    // The user-facing message names the missing files + says to re-download.
    expect(err.message).toContain('pos_emb.bin');
    expect(err.message).toContain('re-download');
  });

  it('isImageModelIncompleteError recognises the class', () => {
    expect(isImageModelIncompleteError(new ImageModelIncompleteError(['x']))).toBe(true);
  });

  it('isImageModelIncompleteError recognises a duck-typed object (survives boundaries)', () => {
    expect(isImageModelIncompleteError({ incompleteModel: true, missing: ['x'] })).toBe(true);
  });

  it('rejects plain errors and non-errors', () => {
    expect(isImageModelIncompleteError(new Error('generic'))).toBe(false);
    expect(isImageModelIncompleteError('incomplete')).toBe(false);
    expect(isImageModelIncompleteError(null)).toBe(false);
    expect(isImageModelIncompleteError(undefined)).toBe(false);
    expect(isImageModelIncompleteError({ incompleteModel: false })).toBe(false);
    // An overridable-memory error must NOT read as incomplete (distinct surfaces).
    expect(isImageModelIncompleteError(new OverridableMemoryError('x'))).toBe(false);
  });
});
