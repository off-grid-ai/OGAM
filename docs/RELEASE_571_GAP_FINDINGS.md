# PR #571 — adversarial gap findings

Verified defects from a four-seam adversarial hunt over the release diff. Each is confirmed
against current code, has a reproducible scenario, and lacks no-mock coverage unless noted.
Ranked by release risk. Each gets a no-mock regression test before it's considered closed.

## Resolution status (all landed on `fix/onboarding-analyzing-device-hang`)

- **G1 — FIXED** (`3eb2d48d` red, `76669003` fix) — validation `corrupt` flag; delete only on provable corruption.
- **G2 — WON'T FIX** — upstream llama.rn HTP/NPU kernel garbles Gemma; not our code. Documented: keep Gemma off HTP.
- **G3 — FIXED** (`d840f7fa` red, `76c97674` fix) — `awaitMemoryReclaim` before the Load-Anyway survival probe.
- **G4 — FIXED** (`82b1c155` red, `0583cb88` fix) — exclude same-key resident from the dirty ceiling.
- **G5 — FIXED** (`c4500a44`) — in-process registry; hydration carries live multi-file downloads forward.
- **G6 — FIXED** (`cd197282`) — zip finalize window marks the in-process registry.
- **G7 — FIXED** (`b4eca3c4`) — reconcile re-unzip gated on `ensureImageExtractionComplete`.
- **G8 — FALSE POSITIVE** — no Pro settings section is registered via the section registry; the Pro
  audio/voice UI is slot-based and IS torn down on revoke (`deactivateAudio` unregisters all 9 slots).
  The flagged `_unregisterSettingsSection` param is harmless dead code. Residual: revoke-live flow has
  no integration coverage (follow-up test, not a fix).
- **G9 — FIXED** (`f52c2bec` red+fix) — create the tool-call target from an index even without an id.
- **G10 — facet (b) FIXED** (`989fe6a2`) — forced-final round now scoped like every other round.
  Facet (a) (shared-opening truncation) was a FALSE finding (comparison is against the full previous
  round). Dedicated forced-round-replay test is a follow-up.

Original findings below, unedited.

## Release blockers / must-decide (P1)

1. **Silent data loss — a valid multi-GB model can be unlinked on a transient FS error.**
   `modelManager/storage.ts:177-190` runs `validateModelFile` on every `loadDownloadedModels`
   (called very frequently). If `RNFS.stat`/read throws transiently for an existing file,
   `validateModelFile` returns `{valid:false}` and the code `unlink`s the user's model and drops
   it from the list; the mmproj sidecar is orphaned and the download row is not reconciled.
   No test covers a *valid* model surviving a transient stat/read error. **Highest-impact.**

2. **Gemma routed to HTP/NPU with no guard → garbled output.** `llm.ts:176-185` applies
   `devices:['HTP0']` for any Android model when `inferenceBackend===HTP`; no per-model/arch
   exclusion despite the known llama.rn HTP-Gemma kernel bug (Qwen fine). A user who enabled HTP
   for Qwen gets gibberish on every later Gemma load, no error. Matches the `htp-gemma-broken` note.

3. **Load Anyway can still be falsely refused (the bug this release exists to kill).**
   `modelResidency/index.ts:375-388` evicts victims then immediately probes RAM via
   `overridePassesSurvivalFloor` with **no `awaitMemoryReclaim`** between eviction and the read
   (that helper exists at `memoryBudget.ts:288` and is used on the load side at `llm.ts:267`).
   iOS page reclaim lags unload, so the probe can read pre-reclaim RAM and refuse a doable load.

4. **Already-resident image model double-counted on thread reload → false "not enough memory".**
   `modelResidency/index.ts:331-336`: `dirtyFootprintMB = spec.sizeMB + keptDirtyMB`, and
   `keptDirtyMB` includes the incoming model's own same-key (`image`) resident. `planEviction`
   guards this (`alreadyResident → 0 cost`); the dirty-ceiling arm does not. Hard refusal for a
   model already in RAM when image threads are changed and generation re-triggered.

5. **Active multi-file image download flips to "failed" on app resume.** Foreground
   `hydrateDownloadStore` (`App.tsx:148`) → `strandInterruptedEntries` (`downloadHydration.ts:156-178`)
   rewrites an active synthetic-key (`image:<id>`) entry to `failed` because no native row matches
   it. Tapping Remove on the false-failed card cancels the still-running transfer and deletes the
   partial tree (orphaned staging, lost progress).

6. **Zip image download stuck in unzip ("processing") is stranded to "failed" on resume**, then
   contradicted by a "downloaded successfully!" alert. Same strand path; the zip finalization has
   no cancellation token so the window can't be interrupted cleanly.

7. **Reconcile re-unzip registers a partially-extracted mnn/qnn model as complete.**
   `modelManager/scan.ts:216-242` re-unzips a `_zip_name` remnant and registers on `isValidZip`
   (size>0 + `PK` header) **without** `ensureImageExtractionComplete`; a truncated-but-PK zip yields
   a partial tree registered as usable → native crash at generation. Live path validates; recovery
   path does not.

## Lower severity (P2)

8. **Pro settings sections survive an entitlement revoke** (asymmetric teardown): `deactivate`
   never calls the `unregisterSettingsSection` it receives (`pro/index.ts:75`), so voice/audio
   sections linger after revoke. Plus the whole revoke-live flow has **zero** integration coverage.

9. **Remote tool call dropped** when the first stream chunk has `index` but no `id`
   (`providers/openAICompatibleStream.ts:142-157`) — tool intent silently vanishes for compatible
   servers that defer `id`.

10. **Multi-round thinking-block text truncated/leaked** — `generationToolLoop.ts`
    `scopeReasoningToCurrentRound` (:1102-1123) drops round-N reasoning that shares a prefix with
    round-(N-1); and the forced-final round (:1327-1332) runs unscoped so prior rounds' reasoning
    can leak into the final thinking block. Display-only.

11. **Dead external-queue code** (`backgroundDownloadService.ts:105-150`, no callers) has a
    starvation seam and no shutdown guard — a hazard when Kokoro/Executorch wire into it.

## Cleared — prior-review scares confirmed FIXED in this release

Stop now stops audio/TTS; vision decode-hang short-circuits (no 4×26s silent retries); tool-markup
leak parsed once at finalize; stuck spinner released on all exit paths; remote credential secrecy
(key stripped from store/persist/logs, lives only in Keychain); embedded MTP gated to capable GGUFs
only; GPU→CPU fallback surfaced in the UI; physical-RAM readout uses `getTotalMemory` (11 GB shows
11.00 GB) and is covered.

## Not addressed by this release (pre-existing, still open)

Remote-server sheet gibberish (UI-render bug, outside these service files).
