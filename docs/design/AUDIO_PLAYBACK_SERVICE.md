# Audio Playback Service — reference architecture

Status: PROPOSED (for review before implementation). Branch: TBD.

## Why (the problem, from the subsystem inventory)

Audio playback/recording is flaky because **no single component owns the shared resources**. Three concerns are spread across many modules with no coordinator:

1. **iOS `AVAudioSession`** is activated in two unrelated places — the recorder (`audioRecorderService` → `playAndRecord`) and the Kokoro bridge (`KokoroTTSBridge` → `playback`). Nobody restores the playback category after recording, and nobody deactivates. Whoever ran last decides the category, so playback is audible or silent depending on history. → "Kokoro silent on iOS", "voice notes silent".
2. **Three independent `AudioContext`s** (`audioFilePlayer`, Kokoro per-`speak()`, OuteTTS per-play) each manage their own `resume`/`suspend`/`close`/foreground-reset. iOS tears contexts down on lock; any one can be reused dead → silent.
3. **Unified playback state** (`playbackStatus`, `currentMessageId`, `currentAudioPath`, `playSessionId`) is written from 5+ sites (`ttsStore`, `ttsPlayback`, `streamingSpeech`, `ttsEngineSubscription`). Different paths clear it differently → stuck non-idle / stale path → gates built on it (the voice-note "busy" gate) mis-fire.

The result: any point-change (a gate, a guard, a resume) can violate an invariant another path assumed. That is the chaos.

## Principle

**One owner per resource; UI/stores depend on a single service interface, never on the implementations.** (SOLID: single responsibility, dependency inversion — already mandated in CLAUDE.md, currently violated for *playback*.)

## Reference architecture

Three layers, each with exactly one owner:

```
            UI (AudioMessageBubble, AudioModeLayout, TTSButton)
                              │  calls only ↓ (no session/context/state access)
        ┌─────────────────────────────────────────────────────┐
        │              AudioPlaybackService                     │  ← sole owner of PLAYBACK STATE
        │  play(item) · pause() · resume() · stop() · seek()    │     + orchestration + serialization
        │  setSpeed() · subscribe(state)                        │
        └───────────────┬───────────────────────┬──────────────┘
                        │ dispatches to one      │ coordinates
            ┌───────────▼─────────┐   ┌──────────▼───────────┐
            │  PlaybackBackend[]   │   │  AudioSessionManager │  ← sole owner of AVAudioSession
            │  (uniform contract)  │   │  forPlayback()/      │     (category + activation, ref-tracked)
            │  • FileBackend       │   │  forRecording()/     │
            │  • EngineBackend     │   │  release()           │
            │  • (future) PcmBackend│  └──────────────────────┘
            └──────────┬───────────┘
                       │ owns its AudioContext via
            ┌──────────▼───────────┐
            │  AudioContextManager │  ← sole owner of AudioContext lifecycle
            │  acquire()/resume()/ │     (resume/suspend, reset-on-foreground in ONE place)
            │  suspend()/reset()   │
            └──────────────────────┘
```

### 1. `AudioSessionManager` (sole owner of `AVAudioSession`)
- The ONLY code that calls `AudioManager.setAudioSessionOptions` / `setAudioSessionActivity`.
- API: `ensurePlayback()`, `ensureRecording()`, `release()`. Tracks the current mode so a `record → play` transition restores `playback` (fixes the "silent after recording" gap), and recording temporarily raises to `playAndRecord` then restores on stop.
- `audioRecorderService`, the file player, and every TTS engine call this instead of touching `AudioManager` directly.

### 2. `AudioContextManager` (sole owner of `AudioContext` lifecycle)
- Owns context creation + `resume`/`suspend`/`close` + **the foreground-reset** (iOS kills contexts on lock). One place handles background/foreground for all playback.
- Backends acquire a context from it rather than `new AudioContext()` scattered around. (Kokoro's 24 kHz requirement is a per-acquire option; the manager still owns lifecycle.)

### 3. `PlaybackBackend` (uniform contract — the polymorphic seam)
```ts
interface PlaybackBackend {
  readonly kind: 'file' | 'engine' | 'pcm';
  canPlay(item: PlaybackItem): boolean;
  play(item: PlaybackItem, ctx: PlaybackHooks): Promise<void>; // resolves on natural end
  pause(): void; resume(): void; stop(): void;
  seek?(fraction: number, durationSec: number): Promise<void>;
  setSpeed(speed: number): void;
  getPosition(): number; // seconds, for the unified clock
}
```
- `FileBackend` wraps today's `audioFilePlayer`; `EngineBackend` wraps the active `TTSEngine` (+ `streamingSpeech` for sentence-by-sentence). They no longer touch the session, the state store, or app-lifecycle.

### 4. `AudioPlaybackService` (sole owner of playback STATE + orchestration)
```ts
type PlaybackItem =
  | { messageId: string; kind: 'file'; audioPath: string; durationSec?: number; startOffset?: number }
  | { messageId: string; kind: 'engine'; text: string };

interface PlaybackState { status: 'idle'|'preparing'|'playing'|'paused'; messageId: string|null; elapsed: number; }

class AudioPlaybackService {
  play(item): Promise<void>; // ensures session, stops current (serialized), picks backend, drives state
  pause(): void; resume(): void; stop(): void;
  seek(fraction, opts): Promise<void>; setSpeed(speed): void;
  subscribe(cb: (s: PlaybackState) => void): () => void;
  onAppBackground(): void; onAppForeground(): void; // delegates to session + context managers
}
```
- The ONLY writer of playback state. `ttsStore` becomes a thin subscriber (keeps its public shape for the UI). Serialization (one playback at a time) lives here, so the **UI has no gates** — tapping a voice note while TTS plays just calls `play()`, which stops TTS first. The only legitimate block (a reply actively generating) is a single check the service exposes.

## Refined invariants (proved by the 2026-06-28 [TTS-SM] device trace)

The live trace turned "it's flaky" into specific, reproduced failure modes. They harden three rules the service MUST enforce — these are the acceptance criteria, not nice-to-haves:

- **R1 — Single writer of playback state.** `playbackStatus`/`currentMessageId`/`elapsed` must be written by exactly ONE owner. Today `streamingSpeech.drain()` writes `currentMessageId: STREAM_MESSAGE_ID` via `useTTSStore.setState` *directly*, racing `ttsPlayback`/`ttsEngineSubscription`. When a voice-note file plays while a stream engages, the file's bubble loses `isThisActive` and the seekbar snaps to 0 while audio keeps going. → the "seekbar at 0 but audio playing" bug. The service owns state; backends only *report* position/events to it.
- **R2 — No wedgeable coordination flag; serialization must be self-healing.** The streaming coordinator's module-global `draining` boolean stuck `true` when a `speak()` hung (Kokoro runtime torn down mid-stream, promise never settled) → its `finally` never ran → every later feed hit "drain: already draining" → no autoplay, no end-play until app relaunch. A single mutable global guarding imperative flow is the anti-pattern. The service's serialization must be a queue with a watchdog/timeout and a reset that always reclaims the lock. (The interim `draining`-clear + `speak` timeout are band-aids that must move INTO the service and the global be deleted.)
- **R3 — Triggers are intents (user actions), never reactive-flag edges.** `audio.stop` used to fire from a `useEffect` keyed on `isStreamingForThisConversation`; that flag bounces false→true on every tool-call round within ONE turn, so it re-fired mid-answer and aborted the live TTS queue. Stop-stale-playback now fires on the genuine send action. The service exposes intents (`play`, `stop`, `interruptForNewTurn`); core calls them from user actions. No playback side-effect is driven by a reactive store edge.

## Gap analysis (current state → owner that fixes it)

| Observed failure | Root layer (today) | Fixed by |
|---|---|---|
| Kokoro silent / voice note silent after recording | AVAudioSession set from 2 places, no restore | **AudioSessionManager** (DONE) |
| Playback dies after lock/background | 3 AudioContexts, ad-hoc resume/reset | **AudioContextManager** (Phase 2) |
| Seekbar at 0 while audio plays | dual writers of `currentMessageId` (R1) | **AudioPlaybackService** sole-writer (Phase 3) |
| "drain: already draining" wedge, no autoplay/end-play | `draining` global stuck on hung speak (R2) | service serialized queue + watchdog (Phase 3); interim timeout/reset until then |
| Streams then stops mid-answer on tool call | `audio.stop` on bouncing reactive flag (R3) | intent trigger at send (DONE) |
| Manual replay → "engine not ready after init" | `KokoroEngine.initialize()` was a no-op | engine load-on-demand via EngineBackend (DONE: now `_ensureBridge`) |
| `std::exception` on every `speak()`, runtime dies | **native** executorch / memory (NOT JS) | **Track N** (contain in service, investigate natively) |
| Aggressive jetsam / OOM on 6 GB voice mode | residency treats TTS as ~82 MB sidecar; real inference working set ignored | **Track M** (residency policy) |

## Migration plan (incremental — each step ships + is device-verifiable on its own)

**Phase 1 — `AudioSessionManager` (sole AVAudioSession owner). ✅ DONE.** Recorder, file player, and Kokoro bridge route through it; `record→play` restores playback; every (re)assert is logged in the trace. *Verified: TTS + voice notes audible after recording.*

**Phase 2 — `AudioContextManager` (sole AudioContext-lifecycle owner).** Move the 3 contexts (file player, Kokoro 24 kHz, OuteTTS) behind one owner that does create + resume/suspend/close + the foreground-reset in ONE place. Backends acquire from it. *Verify: playback survives lock/background on every path.*

**Phase 3 — `AudioPlaybackService` + `PlaybackBackend` (sole state owner + serialization).** This is the heart and resolves R1/R2.
  - 3a. Introduce the service as the ONLY writer of playback state; `ttsStore` keeps its public shape but becomes a thin subscriber/projection.
  - 3b. `FileBackend` wraps `audioFilePlayer`; route `play/seek` for files through the service. *Verify file playback + seek identical.*
  - 3c. `EngineBackend` wraps the active `TTSEngine`; fold `streamingSpeech` into it so it REPORTS position/events to the service instead of writing the store (kills R1). Replace the `draining` global with the service's serialized queue + watchdog (kills R2); delete the interim guards. *Verify streaming start→end, tool-call mid-turn, hung-engine recovery.*
  - 3d. Engine load-on-demand (residency lock) lives in the service uniformly; backends never load.

**Phase 4 — delete UI/store gates.** Remove gates built on raw state (the voice-note "busy" toast, the `PlayButton` `isLoading` non-touchable branch that left a paused message un-resumable); rely on the service's serialization + a single `isGenerating` check. *Verify: no spurious "can't play" toasts; a paused message is always resumable.*

**Track N (parallel, native) — Kokoro executorch stability.** Independent of the refactor. Investigate: model-file integrity after interrupted downloads; the executorch version; whether `std::exception` is `bad_alloc` under the memory ceiling. Outcome may be "Kokoro is unreliable ≤6 GB → gate it / offer a lighter TTS path there." The service only CONTAINS this (timeout, recover, never wedge); it cannot cure it.

**Track M (parallel, memory) — residency policy.** `policy.ts` treats `tts`/`whisper` as small always-coresident sidecars sized by model FILE bytes (~82 MB), ignoring inference working set. On ≤6 GB, text LLM + Kokoro inference + Whisper exceed RAM. Fix: account TTS peak-RAM realistically; evict Whisper after transcription; decide the text-LLM-vs-TTS coexistence budget for ≤6 GB.

Tests at each step: unit (session mode transitions, context reset, state machine, queue watchdog) + integration (record→play, TTS→file interrupt, background/lock/foreground, seek, voice-note-during-generation, hung-engine recovery, tool-call-mid-turn). Every migrated path must be behavior-neutral vs. today (verified against the `[TTS-SM]` trace) before the old code is deleted.

## Non-goals
- Not changing the `TTSEngine` registry/abstraction (that part is sound).
- Not changing Whisper/STT transcription itself (only its residency/eviction in Track M).
- The service does not try to *cure* native Kokoro crashes (Track N) — only contain them.
