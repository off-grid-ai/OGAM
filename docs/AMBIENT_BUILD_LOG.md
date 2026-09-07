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
| Day-view components | in progress (2 of 6 logic built) |

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
| **Journal** — prose recap of the day | [x] `journal` + `journalPrompt` (+ factory) | [ ] | on-device narrative from the day's summaries |
| **Tasks** — action items across the day, checkable | [x] `dayModel.collectDayTasks` | [ ] | flattened with provenance + done-set |
| **Actions** — approval-gated connector proposals | [ ] | [ ] | on `@offgrid/models` proactive-action-policy |
| **Timeline** — the day's conversations | [x] (exists) | [x] (exists) | demote from home → a Day section |
| **Replay** — play a moment's audio | [ ] | [ ] | needs audio player + retained audio |
| **Reflect** — the week | [ ] | [ ] | weekly aggregation over day stores |

### Next up
1. Day store: persist task done-state + the day's journal (per day).
2. `AmbientDayScreen`: compose Journal + Tasks + Actions + Timeline (the new home), replacing the bare timeline as the entry.
3. Actions component (proactive-action-policy) — the wedge.
4. Replay (audio) + Reflect (week).

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
