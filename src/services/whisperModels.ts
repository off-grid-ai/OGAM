// Whisper model catalogue: the downloadable ggml models shown in the model
// picker and Download Manager. Split out of whisperService.ts so that file stays
// focused on load/transcribe. `lang` drives the English-only language forcing in
// whisperService.transcribeFile.
const GGML_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

// CoreML encoder (iOS only): ggerganov ships a per-model `-encoder.mlmodelc.zip`
// alongside each ggml model. Downloaded + unzipped next to the .bin, it lets
// whisper.cpp run the encoder on the Apple Neural Engine (~2-3x faster encode,
// frees the CPU). Path convention: `ggml-<id>.bin` -> `ggml-<id>-encoder.mlmodelc`
// (the zip's own top-level dir already matches). Not published for the akashmjn
// tdrz checkpoint, so that entry has none.
const coreML = (id: string) => `${GGML_BASE}/ggml-${id}-encoder.mlmodelc.zip`;

export interface WhisperModel {
  id: string;
  name: string;
  size: number; // MB, approximate
  lang: string; // 'en' | 'multi'
  url: string;
  description: string;
  coreMLUrl?: string; // iOS CoreML encoder zip, when published for this model
}

export const WHISPER_MODELS: WhisperModel[] = [
  // ── English-only ──────────────────────────────────────────────────────────
  { id: 'tiny.en',   name: 'Tiny',   size: 75,   lang: 'en',    url: `${GGML_BASE}/ggml-tiny.en.bin`,   coreMLUrl: coreML('tiny.en'),   description: 'Fastest, English only' },
  { id: 'base.en',   name: 'Base',   size: 142,  lang: 'en',    url: `${GGML_BASE}/ggml-base.en.bin`,   coreMLUrl: coreML('base.en'),   description: 'Better accuracy, English only' },
  { id: 'small.en',  name: 'Small',  size: 466,  lang: 'en',    url: `${GGML_BASE}/ggml-small.en.bin`,  coreMLUrl: coreML('small.en'),  description: 'High accuracy, English only' },
  // tinydiarize build of small.en: marks speaker-turn boundaries ([SPEAKER_TURN])
  // when transcribed with diarization on. English only; required for the
  // diarization toggle to produce anything (other models ignore tdrz).
  // The only tdrz checkpoint that exists (akashmjn's repo, not ggerganov's). ~465 MB f16; no smaller/quantized variant is published.
  // CoreML: tinydiarize only fine-tunes the DECODER (adds the turn token), so the
  // ENCODER is the standard small.en encoder - we reuse ggerganov's small.en
  // CoreML encoder for the ANE. The download flow renames it to the tdrz path.
  // whisper.cpp's ALLOW_FALLBACK drops to CPU + logs if it's ever incompatible.
  { id: 'small.en-tdrz', name: 'Small (speaker turns)', size: 465, lang: 'en', url: 'https://huggingface.co/akashmjn/tinydiarize-whisper.cpp/resolve/main/ggml-small.en-tdrz.bin', coreMLUrl: coreML('small.en'), description: 'Marks who-spoke turn boundaries, English only (experimental)' },
  { id: 'medium.en', name: 'Medium', size: 1500, lang: 'en',    url: `${GGML_BASE}/ggml-medium.en.bin`, coreMLUrl: coreML('medium.en'), description: 'Near human-level, English only, ~2 GB RAM' },
  // ── Multilingual ──────────────────────────────────────────────────────────
  { id: 'tiny',           name: 'Tiny',             size: 75,   lang: 'multi', url: `${GGML_BASE}/ggml-tiny.bin`,           coreMLUrl: coreML('tiny'),           description: 'Fastest, 99 languages' },
  { id: 'base',           name: 'Base',             size: 142,  lang: 'multi', url: `${GGML_BASE}/ggml-base.bin`,           coreMLUrl: coreML('base'),           description: 'Better accuracy, 99 languages' },
  { id: 'small',          name: 'Small',            size: 466,  lang: 'multi', url: `${GGML_BASE}/ggml-small.bin`,          coreMLUrl: coreML('small'),          description: 'High accuracy, 99 languages' },
  { id: 'medium',         name: 'Medium',           size: 1500, lang: 'multi', url: `${GGML_BASE}/ggml-medium.bin`,         coreMLUrl: coreML('medium'),         description: 'Near human-level, 99 languages, ~2 GB RAM' },
  { id: 'large-v3-turbo', name: 'Large v3 Turbo',  size: 809,  lang: 'multi', url: `${GGML_BASE}/ggml-large-v3-turbo.bin`, coreMLUrl: coreML('large-v3-turbo'), description: 'Fast + accurate, distilled large, 99 languages' },
  { id: 'large-v3',       name: 'Large v3',         size: 1550, lang: 'multi', url: `${GGML_BASE}/ggml-large-v3.bin`,       coreMLUrl: coreML('large-v3'),       description: 'Best quality, 99 languages, ~3 GB RAM' },
];
