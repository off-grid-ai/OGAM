# Adversarial test plan — expose each bug with low/no mocks

**Order of work: TESTS FIRST.** Before any fix, every confirmed bug (Q1–Q18, M1–M11, D1–D4) gets a
**red user-flow test that fails BECAUSE the bug is live** — driven through the real code, mocking only
the genuine boundaries. When the fix lands the same test goes green. No `it.failing` guards that are
green-today (those pin the bug, they don't expose it); no mock of the thing under assertion.

## The principle that makes "low/no mock" possible

Every one of these bugs lives in **our own code** — budget math, residency planning, model-output
parsing, engine dispatch, store persistence, download finalize, settings resolution. Nothing about the
bug depends on the native leaf being real. So the rule is:

- **Run for REAL:** every store (downloadStore, chatStore, appStore, projectStore, whisperStore,
  modelFailureStore) and every service (generationService + helpers, generationToolLoop,
  modelResidencyManager, memoryBudget, activeModelService, imageGenerationService, modelDownloadService
  + providers, litertToolSelector, llmMessages, messageContent/parseModelOutput, modelMedia,
  imageModelIntegrity). These are where the bugs are — they must execute, not be stubbed.
- **Stub ONLY the boundary you physically cannot run in node**, and stub it as an *honest data source*,
  never as a decision-maker. A boundary stub returns plain data (a token, a transcript, a file path, a
  RAM number) and RECORDS what it received (so we can assert "audioUris was []"). It never decides
  `fits`, never parses, never finalizes.

"Low mock" ≠ per-test `jest.mock`. It means **one shared honest-boundary harness** the whole suite
reuses, so the real logic always runs on top of it.

## The shared harness (build ONCE — this is the enabler)

Six boundary fakes under `__tests__/harness/`. Everything else is real. **Use an off-the-shelf fake
for every STANDARD boundary; hand-roll ONLY the first-party native modules — and make those VERIFIED
FAKES** (a shared contract-test suite runs against both the fake and the real module to catch drift;
term of art: "verified fake", per Google SWE ch.13 / Shai Yallin "Fake, Don't Mock"). Library map:
- filesystem → **`memfs`** (or `mock-fs`) behind the RNFS interface — do NOT reimplement file storage.
- MCP/network → **MSW** (`msw/native`, official RN support) — replaces the tools agent's hand-faked XHR.
- clock → **jest fake timers**; UI terminal-artifact → **React Native Testing Library**.
- DB (if any) → real engine `:memory:` (prefer-real tier, above faking).
- `fakeDownloadNative` + `stubEngines` → HAND-ROLLED verified fakes behind the one-typed-TS-contract-
  per-native-capability rule (already mandated in CLAUDE.md); each gets a contract test vs the real module.


1. **`fakeFs`** — an in-memory implementation of the RNFS subset actually used (`exists`, `mkdir`,
   `readDir`, `stat`, `writeFile`, `readFile`/`read`, `unlink`, `DocumentDirectoryPath`). Real enough
   that unzip writes files, `_ready`/`_zip_name` persist, `imageModelIntegrity` scans the REAL file set,
   and a simulated relaunch keeps the disk tree. This is what makes B8/Q17-extraction/D1/D2 real
   without a device — the integrity + finalize logic runs against a true filesystem.
2. **`fakeUnzip`** — `react-native-zip-archive`: given a registered `zip → [files with sizes]` manifest
   built from GROUND TRUTH (`unzip -l` of the real model zips — QNN ships `clip_v2.mnn` + NO `.weight`),
   it writes exactly those files into `fakeFs`. So a QNN extraction really produces the file set that
   trips the integrity bug — the fixture can't lie because it's the real listing.
3. **`fakeDownloadNative`** — the native layer under `backgroundDownloadService`: an event emitter you
   drive (`emitProgress/emitComplete/emitError`), plus `simulateRelaunch()` that drops in-memory rows
   (WorkManager/URLSession semantics). The REAL `useDownloads`, `downloadStore`, `hydrateDownloadStore`,
   and providers consume its events. This exposes D1/D4 honestly: relaunch → no row → does the store
   still surface the failed model?
4. **`stubEngines`** — the native leaves (`llama.rn`, litert native module, `whisper.rn`, TTS native,
   `localDreamGenerator` native): return canned tokens/reasoning/transcript/audio-path/image-path as
   DATA and RECORD their call args. They never decide — so "the enhanced prompt reached the generator"
   / "audioUris was []" / "temperature 1.5 was applied" are real assertions on what our code sent.
5. **`ramSensor`** — `hardwareService.getTotalMemoryGB/getAvailableMemoryGB/refreshMemoryInfo` set to
   exact device numbers; `Platform.OS` toggle. Drives the REAL `memoryBudget`/`budgetForSpec` math.
6. **`clock`** — deterministic time for retry/ordering.

**Simulated relaunch** (needed for D1/B7, persistence): re-create the stores fresh and run the REAL
`hydrateDownloadStore` against `fakeDownloadNative` (which has no row post-kill) + `fakeFs` (disk
survives). On current code the store isn't persisted and the finalize wiped the disk → store empty →
the "model should be retriable after relaunch" assertion FAILS. When persistence/disk-scan lands →
green. No mock hides it — that's the point.

## Per-bug test design (flow · real seams · the one boundary · red assertion)

Each row is ONE user-flow test. "Boundary" = the only thing stubbed. "Fails today because" = why the
correct-behavior assertion is red on HEAD.

### Memory / residency (real `modelResidencyManager` + `memoryBudget` + `activeModelService`)
| Bug | User flow → terminal assertion | Boundary only | Fails today because |
|---|---|---|---|
| M1/Q16 | text resident → start image-gen → assert `getResidents()==['image']` | ramSensor, stubEngines | balanced co-resides both |
| M2 | image(dirty) resident → load 2nd dirty on 640MB-free Android → assert `fits=false` | ramSensor | reclaim credit inflates avail |
| M3 | Load-Anyway 7900MB dirty @665MB free Android → assert refused | ramSensor | floor checks credited ceiling |
| M4 | Load-Anyway 8GB GGUF @1200MB-free iOS → assert refused (working-set charge) | ramSensor | clean load charges 0 to floor |
| M5 | Load-Anyway 2GB dirty @3.1GB-free 12GB iOS → assert allowed | ramSensor | flat 1200 floor over-refuses |
| M11 | image(dirty) resident → resend → text reload → assert loads (post-eviction budget) | ramSensor, stubEngines | budget fixed pre-eviction |
| Q14 | image model → assert `checkMemoryForModel` verdict == `makeRoomFor` verdict | ramSensor | two different size multipliers |
| Q15 | drive `ensureResident` with `fits=false` → assert native load NOT called | stubEngines | ignores `fits`, loads anyway |
> Note: M2/M3/M4/M6 jest proves the gate ADMITS/REFUSES (necessary). The actual jetsam is DEVICE-ONLY
> (Provit) — jest cannot prove the SIGKILL. Both are listed; the jest red test is the gate verdict.

### Engine parity (real generationService/toolLoop/litert dispatch + `modelMedia`)
| Bug | Flow → assertion | Boundary | Fails today because |
|---|---|---|---|
| Q17 | voice note + tool enabled, LiteRT → assert `generateRaw` got `audioUris:[]` | stubEngines | tool-loop bypasses modelMedia |
| Q17b | image + tool, non-vision LiteRT → assert graceful reject, native not hit | stubEngines | no vision gate on tool path |
| Q18 | LiteRT chat → change temp mid-convo → next send → assert native got 1.5 | stubEngines(record) | sampler only pushed on reset |
| Q8 | remote text model + image-gen enhancement → assert enhanced prompt reached generator | stubEngines | generateStandalone has no remote branch |

### MCP / tools (real `mcpService`/`mcpClient`/`generationToolLoop`/`litertToolSelector`)
| Bug | Flow → assertion | Boundary | Fails today because |
|---|---|---|---|
| Q2 | model emits `{name:"x",arguments:{q:1}}` (unquoted) → assert the tool RAN | fake MCP transport (XHR) | strict JSON.parse drops it |
| Q3 | model emits stringified `arguments` → assert server got an OBJECT | fake MCP transport | passed through as string |
| Q4 | router prose contains a tool name / says "none" → assert `[]` selected | stubEngines | substring match force-selects |
| Q5 | tool returns data, empty final turn → assert user sees the DATA not "(No response)" | stubEngines | discards tool result |

### Downloads / failure (real providers + downloadStore + integrity, on fakeFs + fakeDownloadNative)
| Bug | Flow → assertion | Boundary | Fails today because |
|---|---|---|---|
| B8 | fresh QNN zip → extract → assert registered (no phantom .weight) | fakeUnzip(GT), fakeFs | ALREADY FIXED — guard it green |
| D1/B7 | image extract fails → **relaunch** → assert model retriable/removable | fakeFs, fakeDownloadNative | store not persisted + disk wiped |
| D2 | interrupted unzip leaves `_zip_name` → relaunch → assert re-extract | fakeFs | finalize deletes dir+zip first |
| download-restart | network drop @99% → retry → assert resumes or clean re-download | fakeDownloadNative(dynamic) | (verify — reported correct) |
| multifile-trunc | one part 0 bytes → assert reject before register | fakeFs | (verify — reported correct) |

### Settings DRY (real appStore + imageGenerationService + the actual generate arg)
| Bug | Flow → assertion | Boundary | Fails today because |
|---|---|---|---|
| Q1 | set image size 128 → generate → assert native generate got 128 | stubEngines(record) | floored to 256 |
| Q7 | `imageGuidanceScale=0` → generate → assert uses 7.5 default | stubEngines(record) | falls back to 2.0 |
| Q12 | modal Reset to Defaults → assert image params reset too | — (pure store) | resets only 7 text keys |
| Q13 | assert both size sliders share one min/clamp | — (pure) | 128 vs 256 divergence |

### Projects (real projectStore + chatStore + useChatGenerationActions contract)
| Bug | Flow → assertion | Boundary | Fails today because |
|---|---|---|---|
| Q9/Q9b | file chat in project → delete project → assert chat re-filable / no KB-tool inject | — | dangling projectId |
| Q10 | pick project on new chat → send → assert conversation filed | — | lives in local state only |
| Q11 | in project chat → context-full "New chat" → assert new chat inherits project | — | createConversation w/o projectId |

### Voice-model download/management (real whisperService + ttsDownloadActions + residency, on fakeFs)
| Bug | Flow → assertion | Boundary | Fails today because |
|---|---|---|---|
| V1 | download base.en → delete small.en mid-flight → assert base.en still downloading | fakeDownloadNative, fakeFs | cancels single activeDownloadId |
| V2 | truncated ggml file on disk → list → assert NOT listed as completed | fakeFs | name-only filter, no size floor |
| V3 | STT download killed → relaunch → assert failed/retriable entry | fakeFs, fakeDownloadNative | store not persisted + no disk scan |
| V4 | TTS loaded → delete → assert `isResident('tts')==false` | stubEngines | deleteModels skips residency.release |
| V5 | (register 2nd engine) delete non-active engine → assert active unchanged | stubEngines | switches active engine first |

### Thinking / render (MOUNT real ChatMessage — assert on screen, no shape tests)
| Bug | Flow → assertion | Boundary | Fails today because |
|---|---|---|---|
| Q6 | litert streaming reasoning → assert header reads "Thinking…" while streaming | — (render) | isReasoningComplete hardcoded true |

### Voice narration / speak seam (MOUNT MessageRenderer + real turnSpeech; stubEngines record spoken text)
| Bug | Flow → assertion | Boundary | Fails today because |
|---|---|---|---|
| Q19 | assistant reply w/ markdown → tap speak in chat → assert TTS got markdown-stripped text | stubEngines(record) | MessageRenderer strips control tokens only |
| Q20 | direct-audio model, chat mode, standalone note → assert transcript (not empty) sent | stubEngines | Voice.ts bypasses resolveTranscription |

### Infra (safe, no device needed)
| Bug | Assertion | Fails today because |
|---|---|---|
| M10 | a test placed in `__tests__/**/{android,ios}/**` actually RUNS | unanchored `/android//ios/` ignore pattern |

## The device-only ceiling (be honest — jest can't prove these)
For these, the jest red test proves the **necessary** condition (gate verdict / store state); a **Provit
on-device journey** proves the **sufficient** condition. Both are required; don't claim the jest test
alone verifies them:
- M2/M3/M4/M6 — actual jetsam SIGKILL at the admitted size (jest: "gate admits it").
- D1/B7 precondition — WorkManager actually prunes the completed-then-failed row (jest: "store empty ⇒ invisible").
- D4 — iOS URLSession row survival across app-kill.
- Q17 — the native file-not-found/crash (jest: "audioUris reached native non-empty").

## Shared native-boundary harness — REVERSE-ENGINEERED SPEC (build this ONCE, everything mounts on it)

Per the taxonomy (integration = mock ONLY what's outside our system), a real ChatScreen/image-gen flow
runs our WHOLE stack (screen → hooks → generationService/activeModelService/imageGenerationService →
modelResidencyManager → localDreamGenerator/llm/litert) and only the DEVICE leaves are faked. Confirmed
by tracing the image-gen flow: to reach `DiffusionModule.generateImage`, the real `loadImageModel`/
residency needs the RAM + engine leaves seeded too. So a one-off per-test seed fails — seed the SET.

**Native leaves to seed (the complete set):**
- `NativeModules.CoreMLDiffusionModule` / `NativeModules.LocalDreamModule` — image diffusion (destructured at import in localDreamGenerator): `isModelLoaded`, `loadModel`, `unloadModel`, `generateImage(nativeParams)` [assert width/guidance HERE], `getLoadedModelPath`, `cancelGeneration`, `getGeneratedImages`, `addListener`/`removeListeners`.
- `NativeModules.LiteRTModule` — litert engine (destructured at import): `loadModel→{backend,maxNumTokens}`, `resetConversation`, `sendMessage*`, `generateRaw` path, `stopGeneration`.
- `llama.rn` — llama engine (npm; use `__mocks__/llama.rn.js`).
- `react-native-device-info` (`DeviceInfo.getTotalMemory`) + `NativeModules.DeviceMemoryModule` — the RAM sensor read by hardwareService (device-info is npm → likely already jest-mocked; DeviceMemoryModule is dynamic access, seed anytime).
- `whisper.rn` / TTS native — transcript / audio path.
- background-download NativeModule — progress→complete→error events + rows dropped on relaunch.
- `react-native-fs` → memfs (`__mocks__/react-native-fs.js`).

**Injection pattern that works (avoids the `requireActual('react-native')` DevMenu crash AND the
destructure-at-import timing):** for NativeModules-based leaves, `jest.resetModules()` → `const RN =
require('react-native')` → set `RN.NativeModules.X = fake` → THEN `require()` our services (so their
module-scope `const {X} = NativeModules` captures the fake). For npm native packages (`llama.rn`,
`react-native-fs`, `react-native-device-info`), use `__mocks__/` manual mocks (auto-applied before any
import — cleaner than resetModules). PROVEN: this loads the real services without crashing; the only
remaining work is seeding the FULL set so the real load/residency path reaches the native call.

Package this as `__tests__/harness/nativeBoundary.ts` exporting the fake set + an `installNativeBoundary()`
that seeds NativeModules and returns `{ fakes, imageGenerationService, activeModelService, useAppStore, ... }`
freshly required. Then Q1/Q7/Q8/Q17/memory/screen-mount verticals all reuse it.

## Sequencing
1. Build `__tests__/harness/` (the 6 fakes + relaunch). One PR-sized unit, reused everywhere.
2. Write the red journey tests cluster by cluster (memory → engine-parity → mcp → downloads → settings
   → projects → thinking), each RED on HEAD, each named `*.redflow.test.ts` until its fix lands.
3. Only after the red suite exists and is reviewed: the fix plan (grouped by root seam), each fix
   flipping its red test(s) green. That is a SEPARATE plan, made later.
4. Device ceiling: a matching Provit journey list for the on-device-only conditions.
