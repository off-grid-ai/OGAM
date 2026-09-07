# Ambient recorder — build log

> Living tracker for the 24/7 recorder build. Branch: `feat/ambient-107` (off `release/107-feedback`).
> UX: the Day-view prototype (journal · tasks · actions · timeline · replay · reflect).
> Architecture: `docs/AMBIENT_24_7_PLAN.md` + the architecture artifact.
> Convention: pure/DI logic first (unit-tested), then the screen. Tests run; device test deferred.

## Status at a glance

| Area | State |
|---|---|
| Pipeline (capture → transcribe → summarise) | **done**, ported to release ports |
| Ported onto `release/107-feedback` (bundles) | **done** |
| Day-view components | **all 6 live** (journal, tasks, actions, timeline, reflect, replay) |

## The pipeline (Phase 0) — done

- [x] Capture: `audioRecorderService` + `vadSegmenter` (VAD) + `wavSlicer` / shared `planWavSlice`
- [x] STT executor → shared `mobileSpeechInputPorts.transcriber` (on-device **or** remote)
- [x] Sessionizer (conversations), summary prompt + tolerant parser
- [x] Summariser + ask-your-day via shared `executeMobileText` (local **or** remote)
- [x] Timeline model + persisted store, timeline builder (2-phase residency)
- [x] Note-first flagging, on-device-only privacy toggle
- [x] Screens: capture probe, timeline, conversation detail
- [x] **Rewired onto the consolidation's shared ports; app bundles on `release/107-feedback`**

## Day view (Phase 1) — in progress

The lead's model: one Day view, six components, led by "what to do".

| Component | Logic | Screen | Notes |
|---|---|---|---|
| **Journal** — prose recap of the day | [x] `journal` + `journalPrompt` (+ factory) | [x] in Day view | auto-generated once per day, cached |
| **Tasks** — action items across the day, checkable | [x] `dayModel.collectDayTasks` | [x] in Day view | checkable, toggles persisted done-set |
| **Actions** — approval-gated connector proposals | [x] via shared `proactive-action-policy` | [x] Day section | Approve → Share (OS connectors); one-tap MCP routing later |
| **Timeline** — the day's conversations | [x] | [x] Day section | now a section of the Day view |
| **Replay** — play a conversation's audio | [x] `replayClip` + player hook | [x] AmbientReplayScreen | plays the span; player device-verified separately |
| **Reflect** — the week | [x] `reflectModel.reflectWeek` | [x] AmbientReflectScreen | bars, speech, commitments kept, top people |

### Done since last update
- Day store state (doneTaskIds, journalByDay) + pure selectors (sessionsForDay, dayKeysWithSessions).
- `useAmbientCapture` hook — one capture lifecycle shared across surfaces.
- `AmbientDayScreen` — the new home: Journal + Tasks + Timeline + ask + record FAB + day nav. Settings opens it.

### Done since last update
- **Actions** — proposals via the lead's shared proactive-action policy (buildProactiveActionPrompt +
  parseProactiveActions); cached per day; Approve → Share to the OS, Dismiss to drop. In the Day view.

### Done since last update
- **Reflect** — pure week aggregation + `AmbientReflectScreen` (Day header).
- **Replay** — audio refs persisted on sessions; `replayClip` carves a conversation's span out of the
  capture (tested); `useAudioClipPlayer` plays it via react-native-audio-api; `AmbientReplayScreen`
  reached from the conversation detail. **All six Day-view components now exist.**

### Remaining / follow-ups
1. **Device verification** — especially the Replay audio player + the whole rewired STT/generation
   path on `release/107-feedback` (built + bundles; not yet run on a phone).
2. **Audio retention** — Replay assumes the capture WAV persists; add a retention window + cleanup so
   clips resolve and storage stays bounded.
3. One-tap MCP routing for Actions (Mac-side connectors) — beyond the Share fallback.
4. Consolidate: retire the old `AmbientTimelineScreen` (capture now lives in `useAmbientCapture`).
5. Configurable processing (live/nightly/balanced), true always-on, speaker attribution, onboarding,
   move to `mobile-pro`.

## Cross-cutting / deferred
- Configurable processing mode (live / nightly / balanced) — the scheduler + setting.
- True always-on background capture (iOS background-audio spike).
- Speaker attribution (diarization / entity graph).
- Onboarding & autosetup flow (reconcile with Dishit).
- Tier: move to `mobile-pro` before ship.

## Known workspace note (for the lead)
`release/107-feedback` ships **stale committed shared `dist`** — `@offgrid/application` (new, no dist),
`rag`, `use` fail to resolve until `npm run build` is run in `shared`. Anyone building the branch hits
this until it's rebuilt/committed.
