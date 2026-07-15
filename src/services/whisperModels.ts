/**
 * Whisper model catalog + transcription normalization.
 *
 * Extracted from whisperService.ts (behavior-neutral) so the service file stays
 * within the max-lines budget. whisperService re-exports these symbols, so every
 * existing `import { WHISPER_MODELS, cleanTranscription } from './whisperService'`
 * keeps working unchanged.
 */

const GGML_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export const WHISPER_MODELS = [
  // ── English-only ──────────────────────────────────────────────────────────
  { id: 'tiny.en',   name: 'Tiny',   size: 75,   lang: 'en',    url: `${GGML_BASE}/ggml-tiny.en.bin`,   description: 'Fastest, English only' },
  { id: 'base.en',   name: 'Base',   size: 142,  lang: 'en',    url: `${GGML_BASE}/ggml-base.en.bin`,   description: 'Better accuracy, English only' },
  { id: 'small.en',  name: 'Small',  size: 466,  lang: 'en',    url: `${GGML_BASE}/ggml-small.en.bin`,  description: 'High accuracy, English only' },
  { id: 'medium.en', name: 'Medium', size: 1500, lang: 'en',    url: `${GGML_BASE}/ggml-medium.en.bin`, description: 'Near human-level, English only, ~2 GB RAM' },
  // ── Multilingual ──────────────────────────────────────────────────────────
  { id: 'tiny',           name: 'Tiny',             size: 75,   lang: 'multi', url: `${GGML_BASE}/ggml-tiny.bin`,           description: 'Fastest, 99 languages' },
  { id: 'base',           name: 'Base',             size: 142,  lang: 'multi', url: `${GGML_BASE}/ggml-base.bin`,           description: 'Better accuracy, 99 languages' },
  { id: 'small',          name: 'Small',            size: 466,  lang: 'multi', url: `${GGML_BASE}/ggml-small.bin`,          description: 'High accuracy, 99 languages' },
  { id: 'medium',         name: 'Medium',           size: 1500, lang: 'multi', url: `${GGML_BASE}/ggml-medium.bin`,         description: 'Near human-level, 99 languages, ~2 GB RAM' },
  { id: 'large-v3-turbo', name: 'Large v3 Turbo',  size: 809,  lang: 'multi', url: `${GGML_BASE}/ggml-large-v3-turbo.bin`, description: 'Fast + accurate, distilled large, 99 languages' },
  { id: 'large-v3',       name: 'Large v3',         size: 1550, lang: 'multi', url: `${GGML_BASE}/ggml-large-v3.bin`,       description: 'Best quality, 99 languages, ~3 GB RAM' },
];

/**
 * Normalize a raw Whisper transcription: strip the non-speech markers Whisper
 * emits for silence/noise — [BLANK_AUDIO], [ Silence ], [MUSIC], (inaudible),
 * (speaking foreign language), etc. — and return '' when nothing but markers
 * (or punctuation) remains. Without this, a silent/too-short clip returned the
 * literal "[BLANK_AUDIO]" token, which then got SENT as the message text instead
 * of being treated as "couldn't hear that". The single place this rule lives, so
 * every path (file + realtime) treats no-speech identically.
 */
export function cleanTranscription(raw: string): string {
  if (!raw) return '';
  const stripped = raw
    .replace(/\[[^\]]*\]/g, ' ') // [BLANK_AUDIO], [ Silence ], [MUSIC]
    .replace(/\([^)]*\)/g, ' ')  // (silence), (speaking foreign language)
    .replace(/\s+/g, ' ')
    .trim();
  // Only markers / punctuation left → no real speech.
  if (!/[a-z0-9]/i.test(stripped)) return '';
  return stripped;
}
