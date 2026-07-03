# Manual test plan - `fix/llm-stability-and-perf`

What changed on this branch (the SOLID/abstraction/service work) and what must be
rigorously tested on a real device. Unit + integration tests for all of this are green;
the items below are the device-level behaviors a test suite cannot fully prove.

Legend: **[DEVICE]** = needs hands-on / Gungnir replay · **[AUTO]** = covered by the suite.

---

## A. Download service - the single-owner abstraction (biggest area)

**What changed (the seam):** every screen now reads ONE reactive projection
(`useModelDownloads`) backed by ONE owner (`ModelDownloadService`) with per-type
`DownloadProvider`s (text/image/stt/tts). Op routing (cancel/retry/remove) is
authoritative and id-routed; capabilities (cancel/retry/resumable) are data, not
branches. Key changes: `useModelDownloads` hook; service delegation + dead-retry-code
removal; **`uniformDownloadId`** (one id rule both `list()` and the View dispatch use -
fixed STT Remove); **`isModelDownloadInProgress`** + shared `isActiveStatus` so every
surface classifies state the same way; **Kokoro/voice items now read the service** (not a
parallel hook); shared `startModelDownload` (onboarding == Models screen); progress
clamped to [0,1]; multi-file image parts validated before register; no disk self-scan
when no consumer; recommended-models single source.

**Rigorously test:**
- [DEVICE] Start a **single** text model download → progresses, completes, registers, loads.
- [DEVICE] Start **several concurrently** (the real journey) → all advance independently; no >100% bars; correct byte counts.
- [DEVICE] **Stop / cancel** an in-flight download → it stops and disappears; native task cancelled.
- [DEVICE] **Remove** a download (text, image, **STT/whisper**, **TTS/kokoro**) → actually removes (this was the STT-id bug; verify all four types).
- [DEVICE] **Retry** a failed download → restarts and progresses (Android resumes in place; iOS re-downloads).
- [DEVICE] **Kill the app mid-download, relaunch** → in-flight downloads restore/resume and the UI reflects them (not stuck at 0%, not phantom).
- [DEVICE] **Cross-screen sync**: Download Manager, Models→Text/Image tabs, and the Voice panel must all show the SAME state/%/completed for the same model. (Kokoro: must NOT show "downloaded" in DM while the Voice panel shows downloading - the bug Gungnir caught.)
- [DEVICE] **Onboarding "Set Up Your AI" downloads == Models-screen downloads** (same mechanism, same progress reflection).
- [DEVICE] **Failed downloads** (SDXL Core ML, whisper) → show "Something went wrong" + Retry/Remove; investigate WHY image multi-file / iOS URLSession failed while text succeeded (open root-cause).
- [DEVICE] Quant badge shows the real quant (e.g. Q4_K_M), **not "Unknown"** (open display bug seen in DM).
- [AUTO] id routing, capability flags, progress clamp, multi-file validation, hydration/restore, service-boundary dispatch.

## B. Audio / TTS - playback state machine + session ownership (pro + core)

**What changed (the seam):** a single-owner playback state machine
(idle→preparing→playing→paused), session-token guarded; Kokoro `speak()` resolves at TRUE
audio end (not synthesis end); the executorch bridge re-register mid-playback no longer
clobbers phase; voice-switch clears the `isSwitchingVoice` flag on success/error/timeout
(hang fix); realtime Whisper routes the iOS AVAudioSession through `audioSessionManager`;
the Voice panel reads the single download service + the shared in-progress predicate.

**Rigorously test:**
- [DEVICE] **TTS play / pause / resume** on a reply - audible, button state correct, no stuck button.
- [DEVICE] **Auto-speak** after a response (chat + audio mode).
- [DEVICE] **Switch voice** while one is loaded → no hang, no stuck spinner.
- [DEVICE] **Streaming speech** mid-generation drains in order; a new turn supersedes cleanly.
- [DEVICE] **Whisper transcription** (record → transcribe), incl. the iOS session not breaking TTS afterward.
- [DEVICE] Voice panel shows **queued/paused/downloading** Kokoro as in-progress, not the idle CTA.
- [AUTO] playback machine transitions, speak-completion timing, streaming state machine, voice-switch flag clears.

## C. Chat / generation - GenerationSession ownership

**What changed (the seam):** `GenerationSession` is the single owner of "which
conversation is generating" (replaced a 6-writer mutable ref); `hasVisionInputs()` is a
named testable seam; **missing image attachments are dropped before native generation**
(killed the "File does not exist" crash); the LiteRT tool path honors a never-throw
contract.

**Rigorously test:**
- [DEVICE] Send a message → streams; **stop mid-stream** saves the partial; **switch
  conversations while generating** stays correct (no cross-talk).
- [DEVICE] **Vision**: send an image → model sees it; send after the image file is gone →
  it is dropped silently, NO crash, no "File does not exist".
- [DEVICE] **Tool loop** (MCP/LiteRT) runs without silent lies or crashes.
- [DEVICE] Concurrent-generation guard: a second send while generating is handled.
- [AUTO] generation flow, GenerationSession projection, hasVisionInputs, tool loop.

## D. Models / residency / memory

**What changed (the seam):** `Eject All` is a single side-effect owned by
`activeModelService.ejectAll()` (chat sheet + home both delegate); **eject evicts from RAM
but KEEPS the selection** (eject != deselect); memory budgets mmap'd GGUF against physical
RAM (not the dirty-memory limit); residency `makeRoomFor` is predictive.

**Rigorously test:**
- [DEVICE] **Eject All** from the chat models sheet and from Home → unloads from RAM, the
  model stays SELECTED (re-loads on next use; not blanked to "Unknown").
- [DEVICE] Load a large model near the RAM ceiling → loads (predictive budgeting), no false refusal, no OOM.
- [AUTO] ejectAll count + keep-selection, residency loaders.

## E. Routing - image vs text intent

**What changed:** `[ROUTE-SM]` logs every classifier verdict; image intent now matches
article-less visual requests ("draw dog", not just "draw a dog").

**Rigorously test:**
- [DEVICE] "draw a dog" / "draw dog" / "generate an image of X" → routes to image gen.
- [DEVICE] Normal text prompts → stay text.
- [AUTO] intent classifier patterns.

## F. UI / dev tooling

**What changed:** persistent on-device log file sink (`Documents/offgrid-debug.log`,
behind `__DEV__`); bottom-bar loader sized to the mic with matched gaps; Models sheet +
Set-Up footer padding; **dismissable Off Grid AI Desktop promo card** on Home
(`desktopPromoDismissed`, persisted).

**Rigorously test:**
- [DEVICE] Bottom bar: loader sits where the mic is; top/bottom gaps match.
- [DEVICE] Set-Up screen: no oversized gap below "Skip for Now".
- [DEVICE] Home: Desktop card shows, dismiss (X) hides it and stays hidden across relaunch; tap opens the desktop URL.
- [AUTO] promo card render/dismiss/persist/URL.

## G. Test-suite health

- 151 stale RNTL tests fixed (Chat mocks missing `ThinkingIndicator`/`ModelFailureCard`;
  SharePrompt copy drift). Download Manager tests rewritten to assert service-boundary
  dispatch. Full suite green (249 suites / 6223 pass + 12 pro/audio suites).

---

## Known open items (not regressions)

- Quant badge "Unknown" in the Download Manager (display).
- Kokoro voice download not reflecting progress in the Voice panel after tap (the live
  bug Gungnir caught; the pro fix exists but the device build may predate it).
- Why image multi-file / iOS URLSession downloads failed while text succeeded.
- Remote-server bottom-sheet gibberish (deferred; in memory).
- pro `fix/remove-mcp-context-boost` is 4 behind origin - rebase before pushing.
