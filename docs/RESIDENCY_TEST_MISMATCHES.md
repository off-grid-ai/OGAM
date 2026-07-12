# Residency test mismatches — for review

When a residency/co-residency/auto-eviction/budget test (T115–T120 and beyond) **cannot reproduce** what the
device evidence says (`DEVICE_TEST_FINDINGS.md`, `DEVICE_SESSION_COMMENTARY.md`, `docs/wire-captures/`, the
prior conversation summary), it is logged HERE rather than forced to a false green or a wrong-reason red.

Each entry: what the finding/log expected, what the test actually observed, the trace evidence
(`DEBUG_LOGS=1`), and the hypothesis (device-only behavior / stale finding / harness gap / real code
divergence). Nothing here is "done" — each is a question for the human to resolve on return.

Format:
- **[Txxx] <one-line>** — Expected (from <source>): … · Observed (test): … · Trace: … · Hypothesis: … · Status: OPEN

---

- **[T119] whisper blocked→free→retry — DEFERRED (harness gap, not a device mismatch)** —
  Expected (from `DEVICE_TEST_FINDINGS.md` B1 + `ensureWhisperForTranscription.ts`): on a tight device where a
  heavy text model owns RAM, recording a voice note makes `whisperStore.loadModel` return `'blocked'` (the
  sidecar rule won't evict the heavy), so `ensureWhisperForTranscription` calls `freeGenerationModels()` then
  retries → whisper loads, the transcript reaches the model. · Observed (test): not yet built — reproducing the
  `'blocked'` verdict needs (a) whisper **downloaded but NOT resident** (the harness `setupWhisperModel` both
  downloads AND selects+loads, so there's no "downloaded-only" state), and (b) a `setBudgetOverrideMB` tuned so
  the text model fills the budget and the small STT sidecar can't co-reside — plus confirming the AUDIO-mode
  voice path actually calls `ensureWhisperForTranscription` (it may warm whisper eagerly, in which case the
  blocked path is chat-mode-only). · Trace: n/a (not run). · Hypothesis: harness needs a
  `downloadWhisperOnly()` helper (download gesture, no select) + a budget knob; the code path itself is real
  and unit-tested (`ensureWhisperForTranscription`). · Status: OPEN — needs a focused session + a small harness
  addition. Not a device-behavior mismatch; a test-infra gap.
- **[T015] llama NPU (HTP) loads but generation is gibberish — DEFERRED (native-only, no JS surface)** —
  Expected (from `DEVICE_TEST_FINDINGS.md` B22): on SM8635 (qnn `min`), selecting the NPU (Beta)/HTP backend
  loads cleanly (layers on HTP0, no fallback) but generation emits garbage tokens; the product-correct
  outcome is a coherent answer. · Observed (analysis, not a test): there is NO app-side gate or JS decision
  to assert — grep of `src/services` confirms the HTP path (`llmHelpers.initContextWithFallback` +
  `llm.ts` HTP branch) loads normally and streams whatever the native runtime emits; nothing detects
  gibberish, and nothing blocks/warns NPU for gemma-style models. The gibberish is decided entirely by the
  Hexagon firmware/quantization (B22 confirmed genuinely on HTP, no fallback). · Trace: n/a. · Hypothesis:
  a "reply is coherent" UI test would only assert the tokens the fake was told to emit (testing-the-fake,
  red-for-the-wrong-reason) — the real fix is native, not JS. The load-path GPU/backend surfacing IS covered
  by T014 (GenerationMeta shows the backend/layers). If the product later adds an app-side guard (detect
  gemma+HTP → fall back to CPU, or warn), THAT guard becomes a real UI test. · Status: OPEN — native-only;
  needs a device (Provit N/A) to verify, or an app-side guard to make it JS-testable. Not a false green.
- **[T019] litert context-clamp drops tools — DEFERRED (native-only, no JS seam)** —
  Expected (from `DEVICE_TEST_FINDINGS.md` B25): litert GPU clamps context 4096→880; a thinking+tools prompt
  then doesn't fire the tool (880 too small for the tool-augmented system prompt). · Observed (analysis): the
  clamp ADOPTION is JS-observable (`litert.ts:111-115` logs it + updates `configuredMaxTokens`), but grep of
  `generationToolLoop.ts`/`generationService.ts`/`litertToolSelector.ts`/`litert.ts` shows NO code that gates
  or drops tools on context size — `configuredMaxTokens` only feeds the compaction threshold + stats, and
  compaction PRESERVES tools. The clamp→tool-drop happens inside the native LiteRT runtime (it simply doesn't
  emit `litert_tool_call`). · Trace: n/a. · Hypothesis: to test it emergently the LiteRTFake would need (a) a
  per-load `maxNumTokens` override AND (b) an onSend rule that suppresses a scripted tool call when the
  tool-augmented prompt exceeds the clamp — but even then it only tests the fake's model of native behavior,
  because no OGAM JS code produces or prevents it. The honest fix is an app-side guard ("tools don't fit the
  clamped context → warn / disable tools"), which would then be UI-testable. · Status: OPEN — native-only;
  needs the app-side guard to become JS-testable, or a device check. Not a false red.
- **[T021] vision-gguf mmproj-inflated estimate — DEFERRED (harness gap + surface mismatch)** —
  Expected (from `DEVICE_TEST_FINDINGS.md` B3): gemma-4-E2B (main ~2GB + mmproj ~1.85GB) estimates 5854MB
  (`(2048+1855)*1.5`), tripping the "may be too big" warning + forcing CPU fallback. · Observed (analysis):
  (1) the checklist's proposed GenerationMeta GPU/CPU surface is WRONG for B3 — on Android `nGpuLayers` is a
  pure function of the selected backend + total-RAM tier (`getGpuLayersForDevice` ignores modelBytes), so an
  inflated estimate can NEVER flip GenerationMeta to CPU; such a test would be green-on-HEAD regardless of B3
  and would just duplicate T014. (2) B3's real observable is a residency REFUSAL: the inflated `textSizeMB`
  trips `makeRoomFor` → `OverridableMemoryError` → the "Not enough memory" `ModelFailureCard`, even when the
  true footprint fits. (3) The harness can't express it: `setupChatScreen` builds the gguf via
  `createDownloadedModel({...})` and never sets `mmProjFileSize`/`fileSize`, so the mmproj can't inflate the
  estimate. · Trace: n/a. · Hypothesis: needs (a) a `setupChatScreen` option to seed `fileSize` +
  `mmProjFileSize` (+ seed the mmproj file on memfs so `resolveMmProjPath` finds it), then (b) a budget where
  main-alone fits but main+mmproj-inflated does not, asserting the failure card is a FALSE refusal. This is a
  narrow variant of the estimator family already covered by T024/T027/T028 (over-commit / estimator
  divergence). · Status: OPEN — needs the harness mmproj-seed capability + a product decision on the correct
  mmproj multiplier; deferred rather than ship a budget-fragile, surface-mismatched test.
- **[T118] embedding sidecar lazy-load on first RAG query — DEFERRED (harness gap)** —
  Expected (from `embedding.ts:85` + `searchKnowledgeBaseRoundtrip`): the embedding model loads on the first
  real `embed()` (indexing a KB doc, or a doc-question → `search_knowledge_base` → embed), registers as
  `type:'embedding'`, co-resides as a sidecar → In Memory should list `resident-item-embedding` with its RAM. ·
  Observed (test): not built — reaching a REAL `embed()` via UI needs either a KB **doc-attach** gesture or a
  full **project + KB + doc-question** chat round-trip; the existing project UI tests seed via
  `useProjectStore.setState` (no doc-attach gesture) and every RAG test (`ragFlow`/`embeddingFlow`/
  `searchKnowledgeBaseRoundtrip`) is service-level with NO mounted screen. · Trace: n/a. · Hypothesis: needs a
  RAG UI harness (mount the project/KB screen + a real attach-document gesture, or a chat harness that files a
  chat under a project with a seeded-but-embeddable doc). The embedding residency registration itself is real
  and service-covered. · Status: OPEN — needs a RAG UI harness. Not a device mismatch; a test-infra gap.
