/**
 * The image-generation state-machine invariant: `isGenerating` is DERIVED from
 * `phase` (isInFlight), so the indicator can never be shown without an active
 * phase or hidden during one — the desync that made it flash.
 */
import { isInFlight, type ImageGenPhase } from '../../../src/services/imageGenerationService';

describe('image generation phase → isInFlight', () => {
  it('is in-flight only during active phases', () => {
    const active: ImageGenPhase[] = ['enhancing', 'loading', 'generating', 'saving'];
    for (const p of active) expect(isInFlight(p)).toBe(true);
  });

  it('is NOT in-flight for terminal/idle phases', () => {
    const inactive: ImageGenPhase[] = ['idle', 'done', 'error', 'cancelled'];
    for (const p of inactive) expect(isInFlight(p)).toBe(false);
  });
});
