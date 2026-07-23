# Bug backlog — verified, one PR each

The branch `fix/onboarding-analyzing-device-hang` accumulated **330 commits** (≈40 real bug
fixes + ≈270 test/doc commits) bundled together. Bundling made the individual fixes
unverifiable, which is where the breakages came from.

This backlog splits that delta back into **discrete bugs**. We work them **one at a time,
one PR each**, each fix isolated and verified on-device (per the no-merge-without-Provit rule)
before the next starts.

- **Base branch:** `fix/verified-bugfix-backlog` (off `main` @ `856bca12` / 0.0.103).
- Each bug below references the originating commit(s) on `fix/onboarding-analyzing-device-hang`
  so the known-good fix can be extracted, reviewed cleanly, and re-verified — not reinvented.
- Status legend: `TODO` · `IN PROGRESS` · `PR OPEN` · `VERIFIED` · `MERGED`.
- **Per-bug loop:** deep-research the issue AND the supposed fix → decide whether it earns a PR →
  port + verify → next.

---

## Prioritized order

**P0 — live blockers / data loss / crashes users hit now**
1. **A1** — iOS vision "Multimodal support not enabled" (paying user blocked now)
2. **B5** — silent data loss: valid model unlinked on transient FS error (G1)
3. **B8** — Load-Anyway falsely refused: pre-reclaim RAM probe (G3)
4. **B9** — already-resident image model double-counted (G4)
5. **B15** — partial-extract zip registered complete → native crash (G7)
6. **B1** — onboarding hangs on "Analyzing device"

**P1 — functional breakage, recoverable**
B13/B14, B22/B23, B6/B7, B10/B11/B12, B33, B35/B36, B31, B27/B28, B39/B40, B2/B3/B4.

**P2 — polish / edge / display-only**
B24/B25/B26, B16–B21, B29/B30/B32, B34, B37/B38/B41, B42/B43/B44, B45, A2.

---

## Section A — NEW / open bugs (solve fresh, no existing fix)

> **Method (set 2026-07-23):** every bug is proven with a REAL automated test that exercises the
> real external boundary — e.g. A1's test calls Hugging Face live (no mocks) and runs the real
> pair→rename→belongs pipeline over what HF actually publishes. Same approach for the download/zip
> bugs (B13–B21): drive the real download/unzip/reconcile pipeline, fakes only at the device edge.

### A1. iOS: non-Qwen vision model crashes with "Multimodal support not enabled" `FIX APPLIED — awaiting on-device`
Branch `fix/ios-vision-mmproj-not-initialized` (`62fae4a8` test, `e4380b30` fix). Root cause: ggml-org
names projectors `mmproj-<ModelName>-<quant>.gguf` (model name AFTER "mmproj"); the old `/mmproj.*$/`
in `mmProjLocalName` baked that name into the on-disk file → doubled identity stem → `mmProjBelongsToModel`
refused it → `linkOrphanMmProj` cleared the link → text-only load → `initMultimodal` never ran. Fix:
keep only the precision token. Proven against LIVE HF: 8 rename-broken vision repos (3 curated: SmolVLM,
SmolVLM2-2.2B, SmolVLM2-500M-Video; + SmolVLM-256M/500M, Qwen2.5-VL-3B/7B, pixtral, InternVL) now pass;
the 6 already-working repos stay working. **Gate before PR/merge: repair SmolVLM on the `.dev` iOS build →
attach image → vision answers (`[WIRE-VISION] … initialized:true`).**

### A3. Vision projector NOT paired at all for several wild repos (`no-pairing`) `TODO`
Discovered during A1's live-HF sweep. `pickMmProjForDownload` returns nothing (so no projector is ever
downloaded → text-only) for these shapes: `mmproj-model-<prec>.gguf` literal token (ggml-org gemma-3,
openbmb MiniCPM-V), a `UD-`packaged model quant (ggml-org Mistral-Small-3.1), and an infixed `mmproj` on a
`-text-model-` weights name (moondream). **None are curated** → lower priority than A1, but real. Tracked
as a ledger assertion in A1's network test so a new break/fix is caught. Separate seam (`mmproj.ts`
`pickMmProjForDownload`), separate PR.

### A1-orig. (original A1 note kept for reference)
**Reported:** 2026-07-23 (Christophe Marinier, iPhone 12 iOS 26.5.2 / also iOS 17; app v0.0.102).
- Model: `SmolVLM-256M-Instruct-Q8_0.gguf`. Model loads, Repair reports success, image
  attaches — then generation throws **"Multimodal support not enabled. Call initMultimodal first."**
- Works on the Qwen 3.5 vision family; fails on SmolVLM and (per Mac) "the others" → **iOS-specific
  delta in how the mmproj projector is stored/named/linked per model family.**
- Seam: `src/services/mmproj.ts` (`pickMmProjForModel` / `mmProjBelongsToModel` / stem matcher),
  `src/services/modelManager/mmProjLinker.ts`, `download.ts` `mmProjLocalName`, and the load-path
  `initMultimodal` (`src/services/llm.ts:228`, `src/services/llmHelpers.ts:352`).
- Hypothesis to verify on-device: SmolVLM's projector stem / on-disk rename doesn't match
  `modelIdentityStem`, so the strict on-disk matcher refuses it (loads text-only) even though Repair
  "succeeded" → `initMultimodal` never runs. Confirm with the `[LLM]`/`[linkOrphanMmProj]` traces
  from a real SmolVLM repair+generate on iOS. Related to OD1 (mmproj dropped on retry).
- **This is the highest-priority open bug** — a paying user is blocked right now.

### A2. Repair Vision has no progress feedback (OD2) `TODO`
~900 MB mmproj re-download hides behind an indeterminate "Repairing…" spinner. Needs determinate
progress. (User-selected in gap findings.)

---

## Section B — bugs already fixed on `fix/onboarding-analyzing-device-hang`
Port + verify each as its own PR. Grouped by subsystem; related commits stay in one PR.

### Onboarding / device fit
- **B1. Onboarding hangs on "Analyzing device"** — render once analysis done + 5s timeout on HF
  metadata calls. `TODO` — `6116eab2`
- **B2. Onboarding shows per-process available RAM, not total device RAM** `TODO` — `5582c2fe`
- **B3. Model file list can't load → no retry** (fail fast + offer retry) `TODO` — `74a4e4dc`
- **B4. Device-fit chips: loadable models hidden instead of shown with fit tier** `TODO` —
  `44ab2311`, `e7dfb387` (feat), `1ffbfaf1` (falsy-0 badge guard)

### Model validation / storage
- **B5. Silent data loss: valid multi-GB model unlinked on transient FS error (G1)** `TODO` —
  `76669003` (+red `3eb2d48d`)
- **B6. Corrupt phantom models not removed** `TODO` — `892f66c3`
- **B7. Local model imports not validated** `TODO` — `e18f1525`

### Memory / residency / Load-Anyway
- **B8. Load-Anyway falsely refused: survival probe reads pre-reclaim RAM (G3)** `TODO` —
  `76c97674` (+red `d840f7fa`)
- **B9. Already-resident image model double-counted on thread reload (G4)** `TODO` —
  `0583cb88` (+red `82b1c155`)
- **B10. Catastrophic memory survival floor not enforced** `TODO` — `75a45194`
- **B11. Broken recovery after deleting a resident model** `TODO` — `50c283f4`
- **B12. Local model not freed on remote activation** `TODO` — `9b7c7e39`

### Downloads / image extraction
- **B13. Active multi-file image download flips to "failed" on app resume (G5)** `TODO` —
  `c4500a44` (+red `966bcb88`)
- **B14. Zip image download stranded to "failed" during unzip window (G6)** `TODO` — `cd197282`
- **B15. Reconcile re-unzip registers partially-extracted model as complete (G7)** `TODO` —
  `b4eca3c4`
- **B16. Failed image extraction retry not reconciled** `TODO` — `b76a022a`
- **B17. Image model finalization not serialized** `TODO` — `213fe1cc`
- **B18. Newer download hydration state clobbered** `TODO` — `9287c7fd`
- **B19. Download lifecycle state not truthful** `TODO` — `155ef4f9`
- **B20. Cancelled queued download row lingers** `TODO` — `e219cb0c`
- **B21. Idle download refresh not cancelled** `TODO` — `dd2a0cba`

### Remote tool calls / streaming / reasoning
- **B22. Remote tool call dropped when id arrives after index (G9)** `TODO` — `f52c2bec`
- **B23. Remote parallel tool calls not accumulated by index** `TODO` — `01c3eb84`
- **B24. Multi-round thinking leaked/truncated on forced-final round (G10b)** `TODO` — `989fe6a2`
- **B25. Thinking not isolated across tool rounds** `TODO` — `ada61426`
- **B26. LiteRT thinking not preserved across tool calls** `TODO` — `0dbb8802`

### LiteRT / llama generation
- **B27. LiteRT context compaction not persisted** `TODO` — `f0c7034c`
- **B28. LiteRT vision context overflow not recovered** `TODO` — `bd6ac49b`
- **B29. LiteRT terminal generation state not awaited** `TODO` — `443cc680`
- **B30. LiteRT generation settings not reset** `TODO` — `210a50f9`
- **B31. llama output budget not bound to context** `TODO` — `88ee3a82` (+ `7ce05b68` token-floor)
- **B32. GPU fallback reported more than once per load** `TODO` — `06c4cfa2`

### Pro / entitlement
- **B33. Pro features not revoked live on entitlement loss** `TODO` — `ebc3c177`
- **B34. Pro purchase / OAuth loading state wrong** `TODO` — `7a32f99b`

### Chat / navigation / persistence
- **B35. Chat doesn't open after selecting first model** `TODO` — `65839202`
- **B36. Pending prompt not resumed after model selection** `TODO` — `8f448e7a`
- **B37. Conversation rename flow incoherent** `TODO` — `58954b72` (feat) + `03f5fe2d`
- **B38. App lock not enforced before navigation** `TODO` — `354ea33f`
- **B39. Project documents not preserved across relaunch** `TODO` — `27945cfe`
- **B40. Chat image attachments not persisted durably** `TODO` — `f005a9c6`
- **B41. Maximum text settings not preserved** `TODO` — `2323cab4`

### Voice / whisper / photo permissions
- **B42. Whisper load release not cancelled cleanly** `TODO` — `f55aa7c5`
- **B43. Microphone permission denial not recovered clearly** `TODO` — `afe69149`
- **B44. Denied photo access not explained** `TODO` — `218fd0b5`

### Remote server
- **B45. Remote server lifecycle not secured** `TODO` — `a03a8f01`

---

## Section C — NOT bug fixes (out of scope for this backlog)
Track separately; do not fold into bug PRs.

- **Features:** `522945ac` experimental features settings, `6a824be5` embedded MTP, `3aa4a429` MTP
  metrics, `be5d3355` build number display.
- **CI / infra / release:** `c3764de5`, `691102c4`, `f96a841b`, `48c4c434`, `179d6639`, `1e4f7cde`
  (promote-as-DRAFT), `1eb73848` (sonar). These are real fixes but not product bugs.
- **Test-scaffolding "fixes":** `782a4b8d` close review stability races, `1ec7b049` harden secondary
  recovery journeys — verify these are test-only before discarding.
- **~270 `test:`/`docs:` commits** — the coverage/journey harness. Re-land alongside the fix each
  proves, not as standalone PRs.

---

## Section D — known-open deferred gaps (reference; not yet fixed anywhere)
From `docs/GAPS_BACKLOG.md` — candidate future PRs, need on-device repro first. Highlights:
OD5 Android retry doesn't resume after network drop · OD6/OD10/OD11 Kokoro TTS stuck/serialization/
sidecar co-residency · OD15 Jinja role-alternation on model switch after tool call · QNN
over-recommendation on non-flagship Snapdragons (SM7250 crash) · stale IMG-SM image lock (false
"already generating"). See the gaps doc for the full register.
