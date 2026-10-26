/**
 * The start-picture choice, judged over the REAL shared catalog: what a phone offers when a video should start
 * from a picture, given what the paired computer has. No mocks.
 */
import { chooseStartPicture, startPictureOffer } from '@offgrid/pro/video/studio/startPictureOffer';

const LIGHT = 'off-grid-ai/Wan2.2-TI2V-5B-GGUF-Q4';
const FULL = 'off-grid-ai/Wan2.2-TI2V-5B-GGUF';
const none = new Set<string>();

describe('chooseStartPicture', () => {
  it('uses a start-picture model the computer already has', () => {
    expect(chooseStartPicture({ memoryGb: 16, installed: new Set([LIGHT]), downloading: none })).toMatchObject({
      kind: 'installed',
      offer: { id: LIGHT },
    });
  });

  it('follows a download already running on the computer, never a second one', () => {
    expect(chooseStartPicture({ memoryGb: 64, installed: none, downloading: new Set([FULL]) })).toMatchObject({
      kind: 'downloading',
      offer: { id: FULL },
    });
  });

  it('resumes a download that stopped part way', () => {
    expect(
      chooseStartPicture({ memoryGb: 34, installed: none, downloading: none, stopped: new Map([[LIGHT, 35]]) }),
    ).toEqual(expect.objectContaining({ kind: 'stopped', offer: expect.objectContaining({ id: LIGHT }), percent: 35 }));
  });

  it('offers the Light build when the computer fits it without clear room for Full quality', () => {
    expect(chooseStartPicture({ memoryGb: 34, installed: none, downloading: none })).toMatchObject({
      kind: 'download',
      offer: { id: LIGHT, minRamGb: 24 },
    });
  });

  it('offers Full quality only with clear room', () => {
    expect(chooseStartPicture({ memoryGb: 64, installed: none, downloading: none })).toMatchObject({
      kind: 'download',
      offer: { id: FULL },
    });
  });

  it('says the computer is too small when nothing fits', () => {
    expect(chooseStartPicture({ memoryGb: 16, installed: none, downloading: none })).toEqual({
      kind: 'tooSmall',
      memoryGb: 16,
      needsGb: 24,
    });
  });

  it('offers the Light build to an older Desktop that does not report its memory', () => {
    expect(chooseStartPicture({ installed: none, downloading: none })).toMatchObject({ kind: 'download', offer: { id: LIGHT } });
    expect(startPictureOffer()).toMatchObject({ id: LIGHT });
  });
});
