/**
 * DR2 regression: the vision-model verdict used to DIVERGE across three call sites — remote
 * capability detection knew ~18 families, local model-type + HF-search knew only vision/vlm/llava.
 * So Pixtral / Moondream / InternVL reported VISION over a remote endpoint but TEXT-only locally.
 * These tests pin the shared predicate AND assert all three consumers now agree, so it can't
 * diverge again. Consumers are driven for real; the assertion is each one's actual verdict.
 */
import { looksLikeVisionModel, VISION_NAME_PATTERNS } from '../../../src/utils/visionModel';
import { detectVisionCapability } from '../../../src/services/remoteServerManagerUtils';
import { getModelType } from '../../../src/screens/ModelsScreen/utils';
import type { ModelInfo } from '../../../src/types';

// The families that were recognised remotely but NOT locally before the fix — the actual bug.
const PREVIOUSLY_DIVERGENT = ['pixtral-12b', 'moondream2', 'internvl2-8b', 'qwen2-vl-7b', 'minicpm-v-2.6', 'yi-vl-6b'];
const PLAIN_TEXT = ['llama-3-8b-instruct', 'mistral-7b', 'qwen2.5-7b', 'phi-3-mini', 'gemma-2-9b'];

describe('looksLikeVisionModel (shared predicate)', () => {
  it.each(PREVIOUSLY_DIVERGENT)('detects %s as vision by name', name => {
    expect(looksLikeVisionModel({ name })).toBe(true);
  });

  it.each(PLAIN_TEXT)('does not flag plain text model %s', name => {
    expect(looksLikeVisionModel({ name })).toBe(false);
  });

  it('detects by tag even when the name has no vision marker', () => {
    expect(looksLikeVisionModel({ name: 'my-custom-model', tags: ['multimodal'] })).toBe(true);
    expect(looksLikeVisionModel({ name: 'my-custom-model', tags: ['image-text'] })).toBe(true);
  });

  it('matches by id when name is absent (remote models carry only an id)', () => {
    expect(looksLikeVisionModel({ id: 'org/llava-1.5-7b' })).toBe(true);
    expect(looksLikeVisionModel({ id: 'org/llama-3-8b' })).toBe(false);
  });
});

describe('DR2: remote and local vision verdicts agree (no divergence)', () => {
  const asModelInfo = (id: string): ModelInfo =>
    ({ id, name: id, tags: [], author: 'test', downloads: 0, likes: 0, size: 0 } as unknown as ModelInfo);

  it.each(PREVIOUSLY_DIVERGENT)('%s is vision BOTH remotely (detectVisionCapability) and locally (getModelType)', id => {
    // Before the fix: detectVisionCapability=true but getModelType='text' → the divergence bug.
    expect(detectVisionCapability(id)).toBe(true);
    expect(getModelType(asModelInfo(id))).toBe('vision');
  });

  it.each(PLAIN_TEXT)('%s is NOT vision on either surface', id => {
    expect(detectVisionCapability(id)).toBe(false);
    expect(getModelType(asModelInfo(id))).not.toBe('vision');
  });

  it('every VISION_NAME_PATTERN a remote endpoint recognises is also recognised locally (contract)', () => {
    // Guards the invariant directly: no pattern can be added to the shared list that only one
    // surface honours — both read the same list.
    for (const pat of VISION_NAME_PATTERNS) {
      const id = `org/some-${pat}-model`;
      expect(detectVisionCapability(id)).toBe(true);
      expect(getModelType(asModelInfo(id))).toBe('vision');
    }
  });
});
