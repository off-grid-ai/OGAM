# TTS Engine Interface

## Overview

The TTS subsystem uses a pluggable engine interface that decouples the app from any specific TTS implementation. Engines are registered at startup, the user picks one in settings, and the store delegates all operations through the active engine.

The interface is designed as the first concrete implementation of a broader **On-Device Engine** pattern that will generalize to STT, Vision, and LLM modalities.

## Architecture

```
src/engine/
  types.ts                 # OnDeviceEngine base + TTSEngine interface
  OnDeviceEngineEmitter.ts # Zero-dep typed event emitter
  EngineRegistry.ts        # Generic registry (TTS, STT, Vision, LLM)
  index.ts                 # Barrel + singleton ttsRegistry

  tts/engines/
    kokoro/                # Kokoro TTS via react-native-executorch
      KokoroEngine.ts      # TTSEngine implementation
      KokoroTTSBridge.tsx  # React component bridge (wraps useTextToSpeech hook)
      voices.ts            # 8 voice definitions
    outetts/               # OuteTTS 0.3 via llama.rn
      OuteTTSEngine.ts     # TTSEngine implementation
      models.ts            # GGUF asset definitions
    qwen3/                 # Qwen3-TTS 0.6B (stub)
      Qwen3TTSEngine.ts    # Asset management ready, inference TODO
      models.ts            # Talker + predictor + codec asset definitions
```

## How It Works

### Engine Lifecycle

```
register → getEngine → setActiveEngine → initialize → speak/stop/pause → release
```

1. **Registration** — engines register factories at import time in `engine/index.ts`
2. **Activation** — `ttsRegistry.setActiveEngine('kokoro')` creates the instance and releases the previous engine
3. **Initialization** — imperative engines (OuteTTS) load models via `initialize()`. Hook-based engines (Kokoro) initialize when the bridge component mounts.
4. **Usage** — `engine.speak(text, options)` is the universal entry point
5. **Teardown** — `engine.release()` frees models; `engine.destroy()` also deletes downloaded files

### Event System

Every engine emits typed events. The store subscribes once and syncs state:

- `phaseChange` — idle/downloading/loading/ready/processing/paused/error
- `audioChunk` — streaming PCM data (Kokoro)
- `audioComplete` — full audio buffer (OuteTTS)
- `downloadProgress` — per-asset download progress
- `amplitudeChange` — RMS amplitude for waveform visualization
- `voiceChanged` — active voice updated
- `error` — recoverable/non-recoverable errors

### Store Delegation

The Zustand store (`ttsStore.ts`) is a thin proxy:

```typescript
speak: async (text, messageId) => {
  const engine = ttsRegistry.getActiveEngine();
  if (!engine || !get().settings.enabled) return;
  await engine.speak(text, { speed: get().settings.speed, messageId });
}
```

No engine-specific branching. The store exposes derived booleans (`isReady`, `isSpeaking`, `isPaused`) computed from the engine's phase for backward compatibility with UI components.

### React Bridge Pattern

Some engines (Kokoro) depend on React hooks. These engines return a React component from `getBridgeComponent()`. The `<EngineBridge />` component (mounted in `App.tsx`) renders it:

```
App.tsx → <EngineBridge /> → engine.getBridgeComponent() → <KokoroTTSBridge />
```

The bridge mounts the hook, then pushes an imperative handle into the engine instance. Fully imperative engines (OuteTTS, Qwen3) return `null` — no bridge needed.

## Registered Engines

| Engine | ID | Size | Streaming | Voice Cloning | Status |
|--------|-----|------|-----------|---------------|--------|
| Kokoro TTS | `kokoro` | 82 MB | Yes | No | Production |
| OuteTTS 0.3 | `outetts` | 530 MB | No | Yes | Production |
| Qwen3-TTS 0.6B | `qwen3-tts` | ~650 MB | No | Yes | Stub (not registered) |

## Adding a New Engine

1. Create `src/engine/tts/engines/<name>/` with:
   - `models.ts` — `ModelAsset[]` definitions (URLs, sizes, filenames)
   - `<Name>Engine.ts` — class extending `OnDeviceEngineEmitter<TTSEngineEvents>` implementing `TTSEngine`
   - `index.ts` — barrel exports

2. Implement the interface:
   - `getRequiredAssets()` — what to download
   - `initialize()` — load models into memory
   - `speak()` — text in, audio out
   - `getVoices()` / `setVoice()` — voice management
   - `stop()` / `pause()` / `resume()` — playback control
   - `getBridgeComponent()` — return `null` for imperative engines

3. Register in `src/engine/index.ts`:
   ```typescript
   import { MyEngine } from './tts/engines/myengine';
   ttsRegistry.register('myengine', () => new MyEngine());
   ```

4. It appears in the engine picker on the TTS Settings screen automatically.

## Multimodal Future

The `OnDeviceEngine` base interface generalizes beyond TTS:

```
OnDeviceEngine<TEvents>        # lifecycle, assets, events, capabilities
  ├── TTSEngine                # text → audio (Kokoro, OuteTTS, Qwen3)
  ├── STTEngine (future)       # audio → text (whisper.rn)
  ├── VisionEngine (future)    # image → structured (CoreML)
  └── LLMEngine (future)       # text → text (llama.rn)
```

Each modality shares: lifecycle management, model asset download/delete, typed event system, capability declaration, platform checks, and the React bridge pattern.

The `EngineRegistry<T>` is generic — `new EngineRegistry<STTEngine>()` works identically.

The orchestration layer above would wire engines together:
- **Listen** (STT) → **Think** (LLM) → **Speak** (TTS)
- **See** (Vision) feeds context to **Think**

## Qwen3-TTS Integration Path

The stub is ready at `src/engine/tts/engines/qwen3/`. Asset management, download, and lifecycle are implemented. The remaining work is the inference pipeline in `speak()`:

1. Load talker GGUF + predictor GGUF via `llama.rn` (two contexts)
2. Load codec decoder ONNX via `onnxruntime-react-native`
3. Talker generates first-codebook tokens at 12Hz
4. Predictor fills codebooks 2-16
5. Codec decodes token grid to PCM Float32 at 24kHz

Reference: [LunaVox](https://github.com/wkwong/lunavox) has a working desktop implementation of this pipeline.

## Settings Migration

The store handles migration from the pre-engine-interface format automatically via `onRehydrateStorage`. Old fields (`voiceId`, `kokoroVoiceId`) are migrated to `voiceByEngine` map on first load.

## Key Files

- `src/engine/types.ts` — all interfaces
- `src/engine/index.ts` — registry + engine registration
- `src/stores/ttsStore.ts` — store (delegates to active engine)
- `src/components/EngineBridge.tsx` — renders bridge for hook-based engines
- `src/screens/TTSSettingsScreen/index.tsx` — engine picker UI
