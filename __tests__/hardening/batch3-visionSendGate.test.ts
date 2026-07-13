/**
 * BATCH 3 — Chat Attachments & Vision (hardening)
 * File 2: Vision capability gate on SEND + image attachment build (service seam).
 *
 * Drives the REAL message-build seam (src/services/llmMessages.ts). No mocks —
 * these are pure functions over Message[]. Deleting the build logic fails these.
 *
 * The vision gate on SEND has two real implementations already asserted elsewhere:
 *  - LiteRT engine: assertLiteRTImageSupport throws "does not support images"
 *    (covered-real in __tests__/unit/services/generationServiceHelpers.branches.test.ts).
 *  - llama.cpp engine: the image is not turned into a vision marker when the loaded
 *    model reports no vision support — formatLlamaMessages(msgs, supportsVision=false)
 *    emits NO <__media__> marker, so the image is effectively dropped from the prompt.
 *
 * This file locks the llama.cpp send-gate behavior (the image-dropped-when-no-vision
 * path, Provit #27 service side) and the image-attachment build for a vision model
 * (Provit #22/#24/#25 — the built prompt/OAI message actually carries the image),
 * including the MULTI-image build which the existing suite does not cover.
 */

import {
  formatLlamaMessages,
  buildOAIMessages,
  extractImageUris,
} from '../../src/services/llmMessages';
import type { Message } from '../../src/types';

function userWithImages(content: string, uris: string[]): Message {
  return {
    id: 'u1',
    role: 'user',
    content,
    timestamp: 0,
    attachments: uris.map((uri, i) => ({ id: `img-${i}`, type: 'image' as const, uri })),
  };
}

describe('Batch3 · vision send-gate (llama.cpp prompt build)', () => {
  // ── #27 (service side): image is dropped from the prompt when the model lacks vision
  describe('image blocked when active model lacks vision (#27)', () => {
    it('emits NO <__media__> marker when supportsVision is false', () => {
      const prompt = formatLlamaMessages([userWithImages('What is this?', ['file:///a.jpg'])], false);
      expect(prompt).not.toContain('<__media__>');
      // The user's text still goes through — only the image is dropped.
      expect(prompt).toContain('What is this?');
    });

    it('drops markers for EVERY image when several are attached to a non-vision model', () => {
      const prompt = formatLlamaMessages(
        [userWithImages('describe', ['file:///a.jpg', 'file:///b.jpg', 'file:///c.jpg'])],
        false,
      );
      expect(prompt).not.toContain('<__media__>');
    });
  });

  // ── #22/#24/#25: with a vision model the image IS built into the prompt
  describe('image built into the prompt for a vision model (#24, #25)', () => {
    it('emits one <__media__> marker per image when supportsVision is true', () => {
      const prompt = formatLlamaMessages(
        [userWithImages('What is in this image?', ['file:///photo.jpg'])],
        true,
      );
      expect(prompt).toContain('<__media__>What is in this image?');
    });

    it('emits one marker per image for MULTIPLE images (multi-image build)', () => {
      const prompt = formatLlamaMessages(
        [userWithImages('compare', ['file:///a.jpg', 'file:///b.jpg'])],
        true,
      );
      const markerCount = (prompt.match(/<__media__>/g) ?? []).length;
      expect(markerCount).toBe(2);
    });
  });
});

describe('Batch3 · image attachment build (buildOAIMessages)', () => {
  it('builds an image_url content part alongside the text for a single image', () => {
    const [msg] = buildOAIMessages([userWithImages('caption this', ['file:///pic.png'])]);
    expect(Array.isArray(msg.content)).toBe(true);
    const parts = msg.content as any[];
    expect(parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'image_url', image_url: { url: 'file:///pic.png' } }),
        expect.objectContaining({ type: 'text', text: 'caption this' }),
      ]),
    );
  });

  it('builds one image_url part per image for a multi-image message (#35 multi-attach send)', () => {
    const [msg] = buildOAIMessages([
      userWithImages('compare these', ['file:///a.png', 'file:///b.png']),
    ]);
    const parts = msg.content as any[];
    const imageParts = parts.filter((p) => p.type === 'image_url');
    expect(imageParts).toHaveLength(2);
    expect(imageParts.map((p) => p.image_url.url)).toEqual([
      'file:///a.png',
      'file:///b.png',
    ]);
  });

  it('prefixes bare (schemeless) image paths with file:// when building the part', () => {
    const [msg] = buildOAIMessages([userWithImages('x', ['/data/cache/shot.png'])]);
    const parts = msg.content as any[];
    const imagePart = parts.find((p) => p.type === 'image_url');
    expect(imagePart.image_url.url).toBe('file:///data/cache/shot.png');
  });

  it('leaves a text-only user message as a plain string (no content parts)', () => {
    const [msg] = buildOAIMessages([
      { id: 'u', role: 'user', content: 'just text', timestamp: 0 },
    ]);
    expect(msg.content).toBe('just text');
  });
});

describe('Batch3 · extractImageUris (image URIs pulled for the native vision path)', () => {
  it('collects the uris of every image attachment across messages', () => {
    const uris = extractImageUris([
      userWithImages('a', ['file:///1.png']),
      { id: 'assistant', role: 'assistant', content: 'ok', timestamp: 0 },
      userWithImages('b', ['file:///2.png', 'file:///3.png']),
    ]);
    expect(uris).toEqual(['file:///1.png', 'file:///2.png', 'file:///3.png']);
  });

  it('returns an empty array when no message carries an image', () => {
    expect(
      extractImageUris([{ id: 'u', role: 'user', content: 'text', timestamp: 0 }]),
    ).toEqual([]);
  });
});
