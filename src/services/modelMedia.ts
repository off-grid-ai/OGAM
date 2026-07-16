import { MediaAttachment } from '../types';

/**
 * PRODUCT RULE — the single source of truth for which attachments reach the model.
 *
 * Every voice note is transcribed and ONLY its transcript (already in message.content) is sent to
 * the model; the audio attachment is display/playback ONLY, never model input. Sending it is
 * redundant AND its absolute path goes stale on reinstall ("File does not exist" — B9), and a
 * non-audio model rejects it ("Failed to load media" / "does not support audio input" — B5).
 * Images ARE model input (the caller still gates on the model's vision capability).
 *
 * Defined ONCE so every engine path enforces the SAME rule and they cannot drift: the llama/OAI
 * builders (llmMessages.ts) and the LiteRT generation path (generationServiceHelpers.ts). The drift
 * this prevents: the B5/B9 fix landed on the llama path only, so LiteRT still sent the voice-note
 * audio (or hard-rejected it) — the same bug on the other engine.
 */
export function modelInputImageUris(attachments: MediaAttachment[] | undefined): string[] {
  return (attachments ?? [])
    .filter(a => a.type === 'image' && typeof a.uri === 'string' && a.uri.trim().length > 0)
    .map(a => a.uri);
}

/**
 * Audio reaching the model — transcript-only TODAY, so this is empty by rule on EVERY engine.
 *
 * This is the SINGLE seam for the product choice. Models' audio-input capability flags
 * (liteRTAudio / getMultimodalSupport().audio / EngineCapabilities.audio) are intentionally kept
 * as latent data for a future where we DO feed audio to a multimodal model — when that ships, it
 * flips HERE (return capable-model audio uris), and every engine path inherits it at once. Until
 * then no caller hardcodes `[]`; they all go through this one named rule.
 */
export function modelInputAudioUris(_attachments: MediaAttachment[] | undefined): string[] {
  return [];
}
