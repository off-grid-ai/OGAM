# Fast-Follow Backlog (post v0.0.101)

Small polish items deferred from the v0.0.101 stability release. None are release blockers — v0.0.101 shipped with all of them as known, low-impact rough edges. Each is grounded in file:line and should land with a test.

## 1. Re-base image URIs through `resolveDocumentPath` (iOS reinstall → old images blank)
- **Symptom:** After an iOS reinstall (new sandbox container UUID), previously-generated images render blank. Newly-generated images are fine.
- **Root cause:** Audio paths are re-based onto the current container via `resolveDocumentPath()` (`src/utils/resolveDocumentPath.ts`), but image attachment URIs are NOT. `src/services/imageGenerationService.ts:334` stores `uri: file://${result.imagePath}` (absolute, old-container), and `src/components/ChatMessage/components/MessageAttachments.tsx:40` renders `source={{ uri }}` raw.
- **Fix:** Pipe image attachment URIs (chat render + Gallery) through `resolveDocumentPath()` at render time, mirroring the audio fix. + test.
- **Size:** S

## 2. Reload-banner memory-bail feedback (silent no-op under memory pressure)
- **Symptom:** Tapping "Settings changed — tap to reload model" appears to do nothing when the device is memory-starved (observed on Android mid-triple-download; reload unloaded then couldn't refit the model).
- **Root cause:** `handleReloadTextModel` (`src/screens/ChatScreen/useChatScreen.ts:328`) routes through `initiateModelLoad`; on `insufficient-memory` it bails silently. The generate path alerts (`[GEN-SM] ... alerted=true`); the reload path does not.
- **Fix:** Surface the same "not enough memory" alert on the reload memory-bail path. + test.
- **Size:** S

## 3. Queue a send that arrives while the model is still loading
- **Symptom:** Sending a message while a text model is loading dispatches immediately instead of queueing (works out via `ensureModelLoaded` await, but shows no queued indicator).
- **Root cause:** The queue gate (`src/screens/ChatScreen/useChatGenerationActions.ts:402`) only enqueues when `isGenerating`; during a model LOAD nothing is generating.
- **Fix:** (a) also enqueue when `activeModelService.getActiveModels().text.isLoading`; (b) drain the queue on model-load-complete (the queue currently only drains on generation-complete — without this, an enqueued message would be stranded). + test that a send-during-load is queued AND drained when load finishes.
- **Size:** S-M (the drain-on-load-complete hook is the real work)

## 4. Merge the text-engine capability seam
- Branch `fix/text-engine-capability-seam`, commit `0c1fd790` — done + full suite green, sitting in a worktree, not yet merged.
- Builds `TextEngineService` + `activeModelService.supportsVision/ToolCalling/Thinking()` as the single source of truth (kills 5+ duplicated `engine==='litert'?` capability computations — audit B3), engine-agnostic `unloadTextModel` with residency bookkeeping for litert too (B2), real interface in `engines.ts` (H7).
- **Fix:** Merge into main. **Size:** S (already built/tested)

---

## Deferred from the platform-divergence audit (verify, not necessarily fix)
- iOS memory gate: clamp GGUF fit to `min(totalBudget, os_proc_available_memory)` + wire real `lowMemory` flag (ties to the iOS OOM crash cluster). `memoryBudget.ts:48-53`, `DeviceMemoryModule.swift:46`.
- Multi-turn tool calls on iOS (stateless re-prompt) vs Android (native stateful) — verify context holds across a 2nd tool call.
- Background download on iOS restarts from byte 0 on app-kill (Android resumes) — confirm it fails gracefully, not phantom "downloading".

## Hexagon/HTP NPU text support (parked, not scoped for a near-term release)
- Backend is fully wired + unit-tested; gated behind `HTP_ENABLED` + `HTP_UI_ENABLED` (both false). Turning on = ~0.5 day; ship-quality (capability-as-data so the pill can't silently fall back to CPU + on-device tok/s verification) = ~2-4 days. No native blockers.
