# Text-to-Speech Implementation Plan

## Product Vision

Two first-class interface modes, switchable from Chat Settings or TTS Settings:

| Mode | Primary output | TTS role | Text |
|---|---|---|---|
| **Chat Mode** | Text bubbles | Add-on — play button per message | Default visible |
| **Audio Mode** | Waveform bubbles (both sides) | Core — auto-generated at completion | Hidden by default, expandable |

**Audio Mode is the target product experience.** Both the user's voice recordings AND the AI's responses appear as waveform audio bubbles — a full voice-note conversation. No text is shown by default; transcript is always accessible via "Show transcript" expand.

- User voice recordings: right-aligned audio bubbles (recorded WAV, played back locally)
- AI responses: left-aligned audio bubbles (OuteTTS-generated, with 40-bar waveform visualization)

Chat Mode is the fallback for devices that can't run TTS models, or users who prefer text.

---

## Decision Log

### Engine (updated)

**Two-tier TTS architecture:**

| Tier | Engine | Use case | Speed | Size |
|---|---|---|---|---|
| **Tier 1 — Speak (Chat Mode)** | Kokoro via `react-native-executorch` | On-demand speak button, long-press Speak action | ~1s (streaming) | ~100MB |
| **Tier 2 — Generate+Save (Audio Mode)** | OuteTTS 0.3 + WavTokenizer via `llama.rn` | Auto-generate waveform bubble after streaming | ~30–120s | ~527MB |

**Why two tiers:**
- Kokoro via ExecuTorch is fast enough for interactive use (streaming starts < 1s) but outputs raw PCM chunks — no way to write to disk for waveform scrubbing without custom buffering
- OuteTTS via llama.rn generates the full audio up front, returns `Float32Array` + waveform data + duration in one call — ideal for the saved-file + waveform visualisation pattern Audio Mode requires
- OuteTTS is NOT suitable for the speak button (too slow, ~30–120s per sentence)
- Kokoro is NOT currently available as a GGUF via llama.cpp (feature request opened Jan 2025, closed stale Oct 2025, never merged)

**Previous decision (superseded):**
OuteTTS only via llama.rn for both modes. Superseded because ~1 minute to speak a single sentence is not acceptable for interactive use.

### Platform constraint

`react-native-executorch` requires **Android 13 (API 33)** minimum and **iOS 17** minimum.

Current app `minSdkVersion` is **24 (Android 7)**.

**Resolution:** Kokoro speak is available only on Android 13+ / iOS 17+. On older devices, the speak button falls back to OuteTTS (slow but functional). This is detected at runtime — no code path is dead, just slower on older OS.

`minSdkVersion` stays at 24. No breaking change for existing users.

### Playback
**react-native-audio-api** (Software Mansion, already installed). Implements the Web Audio API spec for React Native. Both Kokoro (streaming `Float32Array` chunks) and OuteTTS (full `Float32Array`) pipe through the same `AudioContext → AudioBufferSourceNode` path at 24kHz mono.

### Audio Persistence (Audio Mode only)
In Audio Mode, generated PCM is written to disk as a raw PCM file per message so scrubbing works without re-generating. Files live at:

```
${RNFS.DocumentDirectoryPath}/audio-cache/{conversationId}/{messageId}.pcm
```

Cache eviction strategy:
- Keep the last 50 messages worth of audio per conversation
- User can wipe audio cache from Settings ("Clear audio cache — X MB")
- Estimated size: ~1–4 MB per message (24kHz mono Float32, varies by length)

In Chat Mode, audio is generated (via Kokoro) on demand, played, then discarded (no disk write).

### Voice Selection
- **Kokoro voices (Chat Mode speak):** 8 built-in voices (US/GB English, male/female). Stored as `kokoroVoiceId` in `ttsStore` settings. Default: `af_heart`.
- **OuteTTS voices (Audio Mode waveform):** Single profile (`speaker 0`) — OuteTTS 0.3 multi-speaker not confirmed working via llama.rn. Will expand when OuteTTS 1.0 lands.

### Device Gate
Show a warning (not a hard block) for 6–8GB devices. Hard block below 6GB for Audio Mode (OuteTTS only). Kokoro speak has no RAM gate.

Memory stack (worst case — both models loaded simultaneously):
```
LLM (3B Q4)            ~2.0 GB
Whisper base           ~150 MB
OuteTTS backbone       ~454 MB
WavTokenizer           ~ 73 MB
Kokoro (XNNPACK .pte)  ~100 MB  ← new
OS + app               ~2.0 GB
──────────────────────────────
Total:                 ~4.8 GB  → fits 8GB devices
```

Kokoro and OuteTTS are never loaded simultaneously — Kokoro handles Chat Mode speak (OuteTTS not loaded), OuteTTS handles Audio Mode generation (Kokoro not involved).

---

## Model Files

### Tier 1 — Kokoro (react-native-executorch)

Downloaded automatically by `react-native-executorch` to its internal cache (`react-native-executorch/` in document directory). No manual download management needed.

| File | Source | Size (approx) |
|---|---|---|
| `duration_predictor.pte` | HuggingFace: `software-mansion/react-native-executorch-kokoro` | ~10 MB |
| `synthesizer.pte` | same | ~80 MB |
| Voice `.bin` files (per voice) | same repo | ~3–5 MB each |
| Phonemizer data (tagger + lexicon) | same repo | ~5 MB |

Total cold download: ~100–120 MB. Subsequent launches use cached files.

### Tier 2 — OuteTTS (llama.rn, audio mode only)

| Role | HuggingFace Repo | File | Size |
|---|---|---|---|
| TTS Backbone | `OuteAI/OuteTTS-0.3-500M-GGUF` | `OuteTTS-0.3-500M-Q4_K_M.gguf` | 454 MB |
| Vocoder | `ggml-org/WavTokenizer` | `WavTokenizer-Large-75-Q5_1.gguf` | 73 MB |

Stored at: `${RNFS.DocumentDirectoryPath}/tts-models/`

---

## New Packages

```bash
npm install react-native-executorch
npm install react-native-executorch-bare-resource-fetcher
npm install @dr.pogodin/react-native-fs @kesha-antonov/react-native-background-downloader
```

iOS: `pod install` after.

**Note:** `react-native-executorch-bare-resource-fetcher` requires its own RNFS fork (`@dr.pogodin/react-native-fs`) alongside the existing `react-native-fs`. Both can coexist.

---

## Architecture

### Initialization (`App.tsx`)

```typescript
import { initExecutorch } from 'react-native-executorch';
import { BareResourceFetcher } from 'react-native-executorch-bare-resource-fetcher';

// Called once at startup, before any model hook is used
initExecutorch({ resourceFetcher: BareResourceFetcher });
```

### KokoroTTSManager component

`react-native-executorch`'s `useTextToSpeech` is a React hook — it must live in a component. A `KokoroTTSManager` component mounts near the root, holds the hook instance, and exposes its methods via a module-level ref (`kokoroRef`).

```
App
└── KokoroTTSManager          ← mounts useTextToSpeech, wires to kokoroRef
    └── AppNavigator
        └── ChatScreen
            └── TTSButton     ← calls kokoroRef.stream(text, callbacks)
```

### Speak flow (Chat Mode — Kokoro, fast)

```
TTSButton tap
  → kokoroRef.stream({ text, onNext: playChunk, onBegin, onEnd })
  → AudioContext buffers played as Float32Array chunks arrive
  → Streaming: audio starts < 1s after tap
```

### Voice input flow (Audio Mode — user side)

```
User taps mic button
  → audioRecorderService.startRecording() — records WAV to disk
  → User releases mic
  → audioRecorderService.stopRecording() → { path, durationSeconds }
  → whisperService.transcribeFile(path) — file-based STT
  → onAutoSend(transcript, { uri: path, format: 'wav', durationSeconds })
  → ChatInput builds MediaAttachment { type: 'audio', uri, durationSeconds }
  → onSend(transcript, [audioAttachment]) — content = transcript, attachment = WAV
  → MessageRenderer: user message with audio attachment → right-aligned AudioMessageBubble
  → LLM receives transcript as text input (standard text generation)
```

For models that natively support audio input (e.g. Qwen2-Audio): WAV is passed directly as `input_audio` to the model — Whisper is bypassed entirely.

### Generate+Save flow (Audio Mode — AI side)

```
Streaming LLM response ends
  → triggerAudioModeGeneration(conversationId, messageId, content)
    (reads fresh message from useChatStore.getState() — not stale closure)
  → ttsService.generateAndSave(text, ctx, options)
  → OuteTTS runs inference → Float32Array + waveformData + duration
  → Write PCM to disk → update message { audioPath, waveformData, audioDurationSeconds }
  → MessageRenderer shows left-aligned AudioMessageBubble
```

---

## ttsStore additions

```typescript
// Kokoro state
kokoroReady: boolean;           // useTextToSpeech.isReady
kokoroDownloadProgress: number; // 0–1, during initial model download
kokoroVoiceId: KokoroVoiceId;  // persisted setting

// Actions
setKokoroReady: (ready: boolean, progress: number) => void;
kokoroSpeak: (text: string, messageId: string) => void;  // delegates to kokoroRef
kokoroStop: () => void;
```

The existing `speak()` action becomes:
```typescript
speak: (text, messageId) => {
  if (kokoroReady) {
    kokoroSpeak(text, messageId);  // fast path
  } else {
    // OuteTTS fallback (slow, Android <13 or first launch before Kokoro loads)
    outeTTSSpeak(text, messageId);
  }
}
```

---

## Kokoro Voice IDs

| ID | Label | Accent | Gender |
|---|---|---|---|
| `af_heart` | Heart | US English | Female |
| `af_river` | River | US English | Female |
| `af_sarah` | Sarah | US English | Female |
| `am_adam` | Adam | US English | Male |
| `am_michael` | Michael | US English | Male |
| `am_santa` | Santa | US English | Male |
| `bf_emma` | Emma | British English | Female |
| `bm_daniel` | Daniel | British English | Male |

---

## Files to Create / Modify

### New files
- `src/components/KokoroTTSManager.tsx` — mounts the hook, exposes via ref
- `src/constants/kokoroModels.ts` — voice/model constants mirroring executorch exports

### Modified files
- `App.tsx` — add `initExecutorch()` call + mount `<KokoroTTSManager>`
- `src/stores/ttsStore.ts` — add Kokoro state + `kokoroVoiceId` setting
- `src/services/ttsService.ts` — no change to OuteTTS path
- `src/components/TTSButton/index.tsx` — use Kokoro speak when available
- `src/screens/TTSSettingsScreen/index.tsx` — add voice picker (8 Kokoro voices)

### android/build.gradle
- Bump `minSdkVersion` for executorch: **leave at 24**, guard Kokoro at runtime via `Platform.Version >= 33`

---

## Status

| Task | Status |
|---|---|
| OuteTTS speak (Chat Mode) | ✅ Implemented (slow, functional) |
| OuteTTS generate+save (Audio Mode — AI side) | ✅ Implemented |
| Stale-closure bug fix (reads fresh store state) | ✅ Fixed |
| TTSButton + Speak long-press action | ✅ Implemented |
| Generation vs playback state (spinner) | ✅ Implemented |
| 300-char text truncation | ✅ Implemented |
| checkDownloadStatus on app start | ✅ Implemented |
| User voice recording → audio bubble (Audio Mode) | ✅ Implemented |
| Auto-send on voice stop in Audio Mode | ✅ Implemented |
| User audio bubble right-aligned | ✅ Implemented |
| TTS section in Chat Settings modal | ✅ Implemented |
| Chat Settings modal: TTS Settings deep link | ✅ Implemented |
| Multimodal audio input (bypass Whisper for audio-capable models) | ✅ Implemented |
| Kokoro via react-native-executorch | 🔲 Not started |
| KokoroTTSManager component | 🔲 Not started |
| Voice picker in TTSSettingsScreen | 🔲 Not started |
| Kokoro → OuteTTS fallback for Android <13 | 🔲 Not started |
