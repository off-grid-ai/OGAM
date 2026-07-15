# Test matrix — corner/edge integration at the intersections

Every bug in PR #510 lived at an **intersection** of variants, not inside one function: LiteRT ×
prompt-enhancement, QNN × Android × fresh-download, dirty-model × Android × fit-check, voice-note ×
persisted-conversation × resend. Unit tests pass on each piece; the feature breaks between them. This
doc is how we test the intersections on purpose instead of finding them on-device.

## 1. The axes (the dimensions that actually produce bugs)

| Axis | Values |
|---|---|
| **Text engine** | llama (GGUF) · litert (LiteRT) · remote (gateway) |
| **Model capabilities** | vision (mmproj) · audio · tools · thinking — per engine, as DATA |
| **Input modality** | typed text · voice note in TEXT mode (transcript) · full VOICE mode · image attachment |
| **Feature flow** | plain chat · tool call · image-gen · image-gen + prompt enhancement · TTS out · resend/regenerate |
| **Thinking placement** | none · pre-tool-call thinking · post-tool-call thinking · voice-mode thinking box |
| **Residency state** | cold · text resident · image resident · sidecar (whisper/tts) resident · co-residence pressure · override |
| **Platform / RAM** | iOS · Android × {4, 8, 12 GB} |
| **Asset state** | fresh download · reinstall (stale abs paths) · partial/incomplete · zip vs multi-file · qnn/mnn/coreml |
| **Lifecycle** | fresh launch · after relaunch (persisted) · mid-generation cancel/interrupt |

Full cartesian product ≈ 3×4×5×4×6×3×… = **tens of thousands of cells.** You cannot and must not
enumerate it. Three techniques make it tractable.

## 2. The strategy: journeys + pairwise + a data-driven harness

### (a) Journey tests — the primary deliverable
A journey is a **real user story that crosses several axes**, driven end-to-end through the real seams
(UI intent → service → store/residency/engine → back), asserting the **terminal artifact at each step**
(rendered text, persisted row, the prompt that reached the generator, the file on disk). Mock ONLY the
native boundary (llama/litert/whisper/tts/diffusion native modules, network, clock). Examples:

- *Android · LiteRT E4B*: voice note in text mode → transcript (not audio) sent → tool call → pre- and
  post-tool thinking both render at bubble width → TTS speaks the answer.
- *Android · QNN image*: fresh download → extract → **enhancement swaps text in, image back out** →
  dog image generated from the ENHANCED prompt → resend re-draws the image (not text).
- *iOS · reinstall*: persisted conversation with a voice note whose absolute container path went stale
  → resend resolves the path relative to Documents → generation succeeds.

### (b) Pairwise (all-pairs) for the combinatorial axes
Instead of all N-way combos, cover **every PAIR of axis values at least once**. Pairwise catches the
large majority of interaction defects at a fraction of the cells — and every #510 bug was a *pair*
(engine×feature, backend×platform, modality×persistence). A generator picks a minimal set of scenarios
that hits all pairs; each becomes a journey row.

### (c) The harness: scenario-as-DATA, one runner
A `Scenario` is a plain object, not a bespoke test file:

```ts
type Scenario = {
  name: string;
  platform: 'ios' | 'android';  ramGB: number;
  engine: 'llama' | 'litert' | 'remote';
  caps: { vision?: boolean; audio?: boolean; tools?: boolean; thinking?: boolean };
  resident: ResidentSpec[];           // what's in RAM before the action
  steps: Step[];                      // ordered user intents
  expect: TerminalAssertion[];        // artifacts, asserted from the real entry point
};
```

One runner seeds the real stores + residency manager + engine seam from the scenario, mocks the native
boundary to honor `caps`, executes `steps`, asserts `expect`. A new intersection is **one row**, not a
new file. `describe.each(scenarios)` runs the whole matrix; the pairwise generator fills the rows.

## 3. Intersection risk-map (load-bearing crossings, from our bug history)

Prioritize scenarios that cross these — they have already broken:

1. **engine × every feature** — llama vs litert vs remote for chat / tools / enhancement / thinking.
   (Miss that caused the enhancement-skip: only llama was ever tested.)
2. **modality × engine** — audio is transcript-only, never model media; STT text-mode vs voice-mode.
3. **residency × feature** — image+enhancement must SWAP not co-reside; resend after eviction; sidecar
   never evicts a generation model mid-answer.
4. **platform × memory-type** — Android reclaimable-aware budget; dirty (litert/image) vs clean (GGUF).
5. **asset-state × backend** — qnn (monolithic clip) vs mnn (split-weight) vs coreml; fresh vs reinstall;
   zip vs multi-file; partial extraction.
6. **lifecycle × persistence** — relaunch, stale absolute paths, resend by RECORDED modality.

## 4. Coverage ledger (honest — grows with the harness)

| Intersection | Covered by | Status |
|---|---|---|
| engine × image-enhancement | `imageGenerationFlow` describe.each(llama,litert) | ✅ |
| qnn/mnn extraction integrity | `imageModelIntegrity` (byte-exact zip + on-disk fixtures) | ✅ |
| android/ios × dirty-model fit | `modelResidency` android-reclaimable + ios-unchanged | ✅ |
| audio transcript-only × engine | `llmMessages` (llama + OAI) | ⚠️ litert one-shot audio path unasserted |
| resend × recorded modality | `recordedTurnKind` tests | ⚠️ no litert/image cross |
| STT text-mode vs voice-mode × TTS | — | ❌ journey missing |
| pre/post-tool thinking × engine × voice | render tests exist per-surface | ⚠️ not crossed with engine |
| reinstall stale-path × resend | — | ❌ journey missing (deeper media-path fix) |

`❌`/`⚠️` rows are the backlog — each is a scenario to add, logged in `docs/GAPS_BACKLOG.md`.
