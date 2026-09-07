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
| Day-view components | in progress (journal + tasks + actions + timeline live; Replay/Reflect next) |

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
| **Replay** — play a moment's audio | [ ] | [ ] | needs audio player + retained audio |
| **Reflect** — the week | [ ] | [ ] | weekly aggregation over day stores |

### Done since last update
- Day store state (doneTaskIds, journalByDay) + pure selectors (sessionsForDay, dayKeysWithSessions).
- `useAmbientCapture` hook — one capture lifecycle shared across surfaces.
- `AmbientDayScreen` — the new home: Journal + Tasks + Timeline + ask + record FAB + day nav. Settings opens it.

### Done since last update
- **Actions** — proposals via the lead's shared proactive-action policy (buildProactiveActionPrompt +
  parseProactiveActions); cached per day; Approve → Share to the OS, Dismiss to drop. In the Day view.

### Next up
1. **Replay** (play a moment's audio) + **Reflect** (the week) — the last two components.
2. One-tap MCP routing for Actions (Mac-side connectors) — beyond the Share fallback.
3. Consolidate: retire the old `AmbientTimelineScreen` (capture now lives in `useAmbientCapture`).

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
