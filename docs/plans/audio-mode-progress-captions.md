# Plan: Phase-aware progress captions for audio mode (no "is it broken?" gaps)

## Goal
When a user sends a voice message, several silent gaps occur (prefill, thinking,
TTS synthesis). Today all of them show the same pulsing dots, so the user can't
tell working-but-slow from stuck. Add a short status caption that names the phase,
designed so it can never flicker, reverse, or get stranded.

## Non-goal
Do NOT build a new independent state machine or timers. The caption must be a pure
function of state that already exists, gated by the same condition that mounts the
in-progress bubble, so it cannot outlive or contradict that bubble.

---

## The gaps (current behavior)

| Phase | Trigger | Shown now |
|---|---|---|
| A. Prefill | sent → before first token (~3-5s, audio TTFT) | pulsing dots, silent |
| B. Thinking | reasoning tokens stream (thinking enabled); never spoken | same dots, silent |
| C. Synthesis | answer streaming; Kokoro synthesizing first sentence | play button + tiny spinner, silent |
| D. Playing | audio plays | waveform animates (good) |

Streaming TTS (`pro/audio/index.ts` `audio.onStreamingToken` → `feedStreamingText`)
speaks sentence-by-sentence, so C and the tail of answer-generation OVERLAP. The
design must tolerate overlap rather than force a linear phase.

---

## Design: monotonic phase, pure-derived, playback wins

### Signal sources (read-only; do not add new state)
- Message: `msg.isThinking`, `msg.reasoningContent`, `msg.content`.
- TTS store (`pro/audio/ttsStore.ts`): `playbackStatus`, `currentMessageId`, derived `isSpeaking`/`isLoading`.
- The bubble already mounts on `isStreamingThis || isThinkingItem`
  (`pro/audio/ui/MessageAudioMode.tsx` `renderAudioInProgress`).

### Phase ladder (advance-only)
```
0 waiting   → "Processing your message…"   (in-progress, no reasoning, no answer yet)
1 thinking  → "Thinking…"                   (reasoningContent growing AND content empty)
2 answering → "Preparing audio…"            (content non-empty, TTS not yet playing THIS msg)
3 playing   → (no caption; waveform owns UI)(currentMessageId===msg.id && playing)
```
Rules that kill the failure modes:
1. **Monotonic.** Keep a ref of the highest phase reached for this messageId; never
   render a lower phase even if a signal momentarily regresses. (Prevents flicker /
   backward "Preparing→Thinking".)
2. **Playback wins.** If `ttsStore.currentMessageId === msg.id` and status is
   playing/processing → phase 3, caption empty, waveform shows progress. Never draw a
   caption over real audio.
3. **Cross-message gate.** Only read `playbackStatus` when
   `currentMessageId === msg.id`; otherwise treat as not-playing. (Prevents a prior
   message's TTS state bleeding onto this bubble.)
4. **Lifetime = bubble.** Caption is rendered only inside the in-progress bubble
   (gated on `isStreamingThis || isThinkingItem`). On error/abort/finalize the bubble
   unmounts → caption gone. It can never strand on "Thinking…".
5. **Graceful "thinking" detection.** Only show "Thinking…" when reasoning is actively
   growing AND answer still empty. If the model's reasoning format is unparseable
   (see `buildAudioBubbleProps` note), fall back to "Responding…" rather than assert a
   phase. Never block the answer on a wrong thinking guess.

### Why this avoids the documented risks
- Flicker/reverse → blocked by monotonic ref (rule 1).
- Overlap of generate+speak → playback-wins (rule 2) yields to the waveform.
- Singleton bleed → message-id gate (rule 3).
- Stuck terminal state → lifetime tied to bubble (rule 4); no independent state to leak.
- Parser fragility → graceful fallback (rule 5).

---

## Implementation

### 1. New hook: `useAudioProgressPhase(msg)` — `pro/audio/ui/AudioMessageBubble/useAudioProgressPhase.ts`
- Subscribe narrowly to `ttsStore`: `currentMessageId`, `playbackStatus` (select only
  these two to limit re-renders).
- Compute raw phase from the ladder above using `msg` + gated TTS read.
- Hold `useRef(maxPhase)` keyed by `msg.id`; clamp raw phase up to it (reset the ref
  when `msg.id` changes).
- Return `{ phase, caption }` where caption is '' for phase 3.
- Copy (brand voice — plain, no exclamation, no em dash):
  - 0 → `Processing your message…`
  - 1 → `Thinking…`
  - 2 → `Preparing audio…`
  - fallback → `Responding…`

### 2. `AudioMessageBubble/index.tsx`
- Accept optional `statusCaption?: string` (or call the hook directly when `isLoading`).
- In the `isLoading && !isUser` branch, render the caption as a META-styled `Text`
  beside/under `ThinkingDots`. Keep dots animating (moving indicator + label).
- Use `TYPOGRAPHY.meta` + `colors.textMuted`. No new colors, no hardcoded sizes.

### 3. `MessageAudioMode.tsx`
- In `renderAudioInProgress`, pass the computed caption into `AudioMessageBubble`
  (or let the bubble call the hook; either is fine since it's pure).

### 4. Instant bubble on send (close Gap A's "nothing on screen")
- Verify the assistant in-progress placeholder (`msg.isThinking` item or streaming
  message) is added to the store IMMEDIATELY on send, before prefill completes. If
  there's a delay, the user sees only their own bubble + silence during prefill.
- Trace: core generation path that creates the thinking/streaming placeholder
  (`src/services/generationService*`, `useChatGenerationActions`). If the placeholder
  is created only on first token, add it at generation start for audio mode. Confirm
  on-device that the dots+caption appear within ~100ms of sending.

---

## Tests (both unit + integration, per project rules)

Unit (`__tests__/unit/...`):
- `useAudioProgressPhase`: returns correct caption per signal combo.
- Monotonic clamp: feed phase 2 then a regressing signal → still phase 2.
- Cross-message gate: `currentMessageId` = other id → playback ignored.
- Playback wins: this-id + playing → phase 3, empty caption.
- Unparseable thinking → "Responding…", never blocks.
- Reset on `msg.id` change → maxPhase ref resets.

Integration (`__tests__/integration/...`):
- Simulated send → prefill → thinking → answer → TTS preparing → playing: caption
  advances 0→1→2→'' and never regresses.
- Error mid-thinking: in-progress bubble unmounts, no stranded caption.

---

## Risk register (carry into review)
- Re-render cost: select only 2 TTS fields; memoize caption. Verify no per-token
  re-render storm of all bubbles.
- Streaming vs fallback TTS: "Preparing audio…" may flash briefly (streaming) or
  linger (fallback) — acceptable; both read as "working".
- Copy review: run the brand-voice checklist on the four strings before commit.
