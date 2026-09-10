# Off Grid Mobile — Rules (single source of truth)

**This file is the ONE canonical rulebook for this repo, tool-neutral (Claude, OpenAI Codex, or any
other coding agent). `CLAUDE.md` and `AGENTS.md` are thin pointers to this file — edit rules HERE, not
there.** Read this in full before any substantive work; read the on-device playbook at the bottom
before any device work.

## Repository Layout

**All Pro feature code lives in the `pro/` submodule (its own git repo, `@offgrid/pro`) - not in core.** When changing or adding a Pro feature (e.g. TTS/audio, MCP/tools, and other paid surfaces), edit files under `pro/` and commit/PR them in that repo. Core only wires Pro in through the slot/hook registries; it never imports Pro code directly. Pro changes are a separate branch + PR from core (see `pro/CLAUDE.md`).

## Device Logs (how to see what's actually happening on the device)

**RN 0.83 moved JS `console.log` off the Metro terminal into React Native DevTools, and RN's console never reaches the iOS device syslog.** So `metro` stdout, `idevicesyslog`, and `npx react-native log-ios` (simulator-only) all capture NOTHING from a physical device. Do not waste time tailing Metro for app logs.

Instead, a **dev-only persistent file sink** (`src/utils/debugLogFile.ts`, wired in `App.tsx` behind `__DEV__`) mirrors every `logger.*` line - which is where ALL the state-machine traces go (`[TTS-SM]`, `[GEN-SM]`, `[MODEL-SM]`, `[DL-SM]`, `[ROUTE-SM]`, `[IMG-SM]`, `[MEM-SM]`, `[FAIL-SM]`) - into a file in the app container. Pull it over the cable to read the real trace:

The debug (Debug-config) build's bundle id is **`ai.offgridmobile.dev`** — Debug carries a
`.dev` suffix so it installs alongside the App Store / TestFlight build (`ai.offgridmobile`,
the Release config). The log sink is `__DEV__`-only, so you are almost always pulling from the
`.dev` container. Get the device UDID from `xcrun devicectl list devices` (it is per-device — do
not hardcode one):

```sh
# Read the connected device's UDID from devicectl's JSON (parsing the human-readable table with
# awk is brittle — the last column is the device model, not the UDID). Or just paste the UDID.
xcrun devicectl list devices --json-output /tmp/devs.json >/dev/null 2>&1
DEVICE=$(python3 -c "import json;ds=json.load(open('/tmp/devs.json'))['result']['devices'];print(next(d['hardwareProperties']['udid'] for d in ds if d.get('connectionProperties',{}).get('tunnelState')=='connected'))")
xcrun devicectl device copy from \
  --device "$DEVICE" \
  --domain-type appDataContainer --domain-identifier ai.offgridmobile.dev \
  --source Documents/offgrid-debug.log --destination /tmp/offgrid-debug.log
```

(A Release/TestFlight build uses `--domain-identifier ai.offgridmobile` and has no dev log sink.)

Then `grep`/read `/tmp/offgrid-debug.log`. The file appends a `===== session start … =====` marker on each launch and is size-capped (rotates, keeping the tail). The in-app **Debug Logs** screen (Settings → Debug Logs) shows the same lines live for quick visual checks. **When diagnosing a device issue, pull this file rather than guessing.**

### Metro keeps a stale copy of a rebuilt shared package

Every `@offgrid/*` package is a `file:` symlink into `../shared`, and `tsup --clean` deletes and
recreates `dist/` with new chunk names. Metro's per-client bundle graph (the phone's) often keeps the
OLD dist after that, while a fresh `curl .../index.bundle` shows the new code - so a "reloaded" app
still runs the previous shared build. After rebuilding a shared package: `touch` the files under its
`dist/`, then reload the app (`curl -X POST localhost:8081/reload`); if it still lags, restart Metro
with `--reset-cache`. Prove which code the phone runs before debugging the logic: Metro's Hermes
inspector accepts `Runtime.evaluate` (`curl localhost:8081/json/list` for the socket, then
`__r(<module id from the dev bundle>)` to reach a module's exports).

## Branch Policy

**Never push directly to `main`.** All changes must go through a pull request:

0. Always create a branch specific to the change before committing: `feat/`, `fix/`, `docs/`, `chore/`, `test/`, etc.
1. Push the branch and open a PR - never `git push origin main`.
2. If you find yourself on `main`, create a branch first: `git checkout -b <branch-name>`.

**Merge strategy: ALWAYS a merge commit. NEVER squash (and never rebase-merge).** When merging a PR, use `gh pr merge --merge` (or the "Create a merge commit" button) so the full commit history is preserved on `main`. Do not squash under any circumstances - the small, meaningful per-concern commits are the record and must survive the merge. This applies to both the core repo and the `pro` submodule.

## Hexagonal architecture (standing rule, 2026-09-02)

For ALL packages in `shared`: every business rule lives in the shared `@offgrid/*` package. Desktop and
mobile are dumb components or consumers - I/O adapters, composition roots, and UI. Nothing else. Before
writing a rule in an app, ask "is this a decision or I/O?": a decision goes to shared with a node test,
the app keeps only the port. A rule found in an app file is a defect to move, not a style choice.

Every change follows FPT (first-principles thinking), SSOT, SOLID, DRY, SRP, and Clean architecture.

## Required Development Order

Use this order. Do not start a later gate while an earlier gate is open.

1. Finish the requested production code. Apply YAGNI, SOLID, SRP, SSOT, and DRY. Reuse the smallest
   existing seam that completes the journey. Do not follow unrelated findings or add speculative
   systems.
2. Live-verify the complete journey on the real development surfaces and devices.
3. Write and run E2E checks from the exact successful live steps.
4. Add only the integration tests needed for failure, race, security, offline, or coverage paths.
5. Run production and packaged builds only after the live, E2E, and integration gates pass.
6. Push the reviewed heads to GitHub only after the production builds pass.
7. Keep CI and every valid hosted review signal green on those exact pushed heads.

Type checks, focused lint, and development installs are allowed while coding. They are code gates,
not production-build or release-ready evidence.

### Commit early, commit often - never lose progress (agents especially)

**A long task is a chain of small, GREEN, committed steps - not one giant uncommitted diff.** Agents run against context/session limits; anything uncommitted is lost when the session ends. So:

- **Commit each cohesive step as soon as it is green** (typecheck + the relevant tests pass), with a real per-concern message. A refactor done in slices commits after each slice, not at the end.
- **Never leave a large uncommitted working tree across a risky/long operation.** If you are about to start something big, commit what already works first so there is a clean restore point.
- **Every commit is a safe restore point:** it must be behavior-neutral-or-better and pass the gates for the files it touches. Do not commit a knowingly-broken tree; if mid-refactor is unavoidably broken, finish to green before committing (or stash), never push broken.
- **Prefer many small commits over few large ones.** They survive a merge (we never squash), make review tractable, and mean a lost session costs one step, not the whole task.
- This is not optional polish - it is how work is not lost. Treat "a lot of uncommitted changes" as a bug to fix immediately by landing them as small commits.

## Copy & Content Standards

**Any change to website copy, essays, docs text, UI strings, or marketing content must follow the brand voice guide:**

- Read `docs/brand_tone_voice.md` before writing or editing any copy.
- The full quality checklist is at the bottom of that file - run every item before committing content changes.

Key rules that are easy to miss:

| Rule | Wrong | Right |
|---|---|---|
| Proof-first | "fast" | "15-30 tok/s on flagship devices" |
| Privacy as mechanism | "we value your privacy" | "the model runs in your phone's RAM, nothing is sent anywhere" |
| No exclamation marks | "It works!" | "It works." |
| No em dashes | "private - always" | "private - always" |
| No forbidden words | revolutionary, seamlessly, empower, leverage, robust, comprehensive, crucial, pivotal, delve, tapestry, testament, underscore, foster, cultivate, showcase, enhance | use specific, plain words instead |
| No AI slop phrases | "serves as", "stands as", "represents a", "marks a turning point", "it is worth noting" | just say "is" |
| No structural clichés | "Not just X, but Y" / "It's not X, it's Y" | state the thing directly |
| No curly quotes | "private" | "private" |

The emotional arc for all content: **Recognition -> Return -> Freedom**. Name what's been happening, show what's being given back, hand over the capability without condition.

---

## Design Standards

**Any change that touches UI must follow `brand/DESIGN_PHILOSOPHY.md`, the only design source of truth. Apply its Mobile profile.**

- Use `TYPOGRAPHY` tokens - never hardcode font sizes or weights.
- Use `COLORS` tokens - never hardcode color values.
- Use `SPACING` tokens - never hardcode margin/padding values.
- Weights must stay ≤ 400 (no bold).
- Never use emojis or emoticons in UI text - always use `react-native-vector-icons` instead. Feather is the default; MaterialIcons is allowed only when Feather lacks a suitable icon (e.g. `whatshot` for trending).
- Never use `lucide-react` or any other icon library - only `react-native-vector-icons`.
- Follow the canonical Mobile text hierarchy in the brand guide.

## Reuse Before Building

**Before writing any new component, style, hook, or service, search for an existing one and reuse it.** Building a parallel version of something that already exists creates visual and behavioural drift (e.g. a search box that looks different from every other search box).

- For UI: grep `src/components/` and the relevant screen folder for an existing component or shared style (e.g. `ModelCard`, `Card`, `Button`, shared `searchContainer`/`searchInput` styles) before creating your own. Two screens that show the same kind of thing must use the same component.
- For logic: check for an existing hook/service/store action (`grep -rn`) before adding a new one.
- If an existing component is close but not exact, extend it with a prop rather than forking a copy.
- Only build new when nothing fits - and say so in the PR description.

<!-- BEGIN GENERATED: shared/CLAUDE.md#debugging-source-of-truth -->
> **Generated from `shared/rules.md` - do not edit this section here.**
> Run `node scripts/mirror-doctrine.mjs` in `shared/` after changing the canonical copy.
> `--check` fails the build when a mirror drifts, so these cannot silently disagree.

## Debugging — reason from first principles

**Ask what the thing IS, before you ask what is happening to it.** Name what the code should be in
one sentence ("a side panel is fixed to the right edge, full height"), read what it actually says,
and fix the gap. Almost every hard-looking bug here dissolves at that step.

The failure mode is reaching for the environment instead: measuring window geometry, blaming an OS
setting, inspecting global CSS, theorising about the platform. Those are ways of not reading the
component. A real example: a gap between a side panel and the window edge got attributed to a macOS
tiled-window margin. The actual cause was in the component's own class list — it declared two
competing heights (`h-dvh` on top of `top-0 bottom-0`) inside a clipping wrapper. The fix was to say
the simple thing directly.

So, before any tooling: if the answer requires unusual measurement to explain, the implementation is
probably wrong, and it is complicated where it should be plain. Simplify it and the symptom goes.

**Before any fix: write the invariant and the smallest mechanism.** In one or two lines, state the
invariant the system must hold and the smallest mechanism that gives it. Check that against what
already exists in `shared` or in a library (lodash `throttle`, not a hand-rolled one) before writing
new code. If the fix adds a concept (a cap, a gate, a ratio, a port, a helper) rather than removing
one, that is the signal to stop and re-derive. A real example: "Context is full" on mobile grew a
per-result character budget, a committed-partial gate, and a host-specific window port - when the
invariant was "commit every round; when the window fills, compact what is committed and continue",
which the existing compaction already supports.

## Where the logs live (pull the file before guessing)

Every surface writes one durable log. When a person reports "it did X on the device", read that
file first; it beats reasoning from memory every time.

| Surface | File | How to read it |
|---|---|---|
| Desktop (main process, incl. pro) | `<data dir>/logs/off-grid-ai-desktop.log` - data dir is `OFFGRID_DATA_DIR`, else Electron `userData` (`~/Library/Application Support/Off Grid AI Desktop` on macOS), else `<cwd>/.offgrid`; `OFFGRID_DIAGNOSTIC_LOG` overrides the path | `tail -f` it. Rotates at its size cap. |
| Mobile, iOS (dev build `ai.offgridmobile.dev`) | `Documents/offgrid-debug.log` inside the app container | `xcrun devicectl device copy from --device <UDID> --domain-type appDataContainer --domain-identifier ai.offgridmobile.dev --source Documents/offgrid-debug.log --destination /tmp/offgrid-debug.log` |
| Mobile, Android (dev build) | `files/offgrid-debug.log` inside the app's data dir | `adb shell run-as ai.offgridmobile.dev cat files/offgrid-debug.log > /tmp/offgrid-debug.log` |

The mobile sink is dev-only (`__DEV__`), mirrors every `logger.*` line, appends a
`===== session start … =====` marker per launch, and the in-app Debug Logs screen shows the same lines
live. `mobile/rules.md` carries the full iOS recipe (reading the UDID from devicectl JSON).

## Debugging — start with the source of truth

**Most bugs here are source-of-truth bugs, and the fix is almost always to collapse two sources into
one.** So before reading a stack trace or reaching for a log, ask three questions in order:

1. **What is the source of truth for this fact?** Not "where is the bug" - "who is entitled to answer
   this question". A device's connection state, a model's identity, whether a transfer finished.
2. **Is anything else answering the same question?** Two answers is the bug, even when both are
   individually correct. Look for a value derived twice, a rule written in two layers, a state
   hardcoded next to a state that is computed.
3. **Can we refactor so there is ONE source, and would that fix it?** If yes, that is the fix. Patching
   the wrong answer leaves the second source in place, and it will disagree again somewhere else.

If the answer to 3 is no, say so explicitly and fix the symptom - but say WHY one source is not
achievable, because that is usually a design constraint worth writing down.

### Why this is the default heuristic (a session's worth of evidence)

Every one of these presented as a different bug and was the same bug:

| Symptom | The two sources | The one source |
|---|---|---|
| A connected device had no actions at all on macOS | two hand-written button lists, one per section | one component driven by `device.actions.*.visible` |
| "4 of 5 licensed devices" over a list of one | count from the registry, list from `saved` (which excludes devices that are ON the network) | the whole mesh |
| One model appeared 35 times | absolute path as identity, and iOS moves it every reinstall | `fileName`, unique within the dir |
| Sender said "sent", receiver said "could not receive" | the send loop's "I pushed bytes" vs the receiver's verdict | one package-state rule (`modelPackagePhase`) |
| Activity said COMPLETED for a half-sent model | per-FILE rows vs a package the user asked for | package state, files underneath |
| A live mesh read as half-down | each flow reading device rows its own way | the surface layer owns reading |
| "Needs repair" after a deliberate disconnect | a flag set by one path and clearable only by another | one lifecycle, cleared on the next success |

The tell is almost always the same: **two things that must agree, kept in step by hand.** A comment
saying "these must match" is a bug waiting for a witness; so is a hardcoded literal sitting next to a
computed value (`status: 'completed'` beside a record that also has a status).

### Durability and resilience are SSOT problems too

A fact that is not persisted has no source of truth after a restart - it silently becomes whatever the
UI last remembered. Failures were dropped on the floor (`if (status !== 'completed') return`), so a
failed transfer stopped existing the moment the view reset, and the surface confidently showed success.
When you fix durability, fix the READ at the same time: persisting a failure while the renderer still
hardcodes `status: 'completed'` converts a lost record into a durable lie.

## Hexagonal architecture (standing rule, 2026-09-02)

For ALL packages in `shared`: every business rule lives in the shared `@offgrid/*` package. Desktop and
mobile are dumb components or consumers - I/O adapters, composition roots, and UI. Nothing else. Before
writing a rule in an app, ask "is this a decision or I/O?": a decision goes to shared with a node test,
the app keeps only the port. A rule found in an app file is a defect to move, not a style choice.

Every change follows FPT (first-principles thinking), SSOT, SOLID, DRY, SRP, and Clean architecture.

## Shared owns model business logic (the apps never duplicate it)

The point of the shared monorepo is that Desktop and Mobile never carry two copies of one rule.
Every decision about models lives in a shared package and the apps only supply I/O adapters and
render projections. That covers selection and routing, intent classification, admission and
memory policy, download and registry rules, generation lifecycle and cancellation, remote
discovery, tool orchestration, transfer manifests, and speech/transcription workflows.

**Standing instruction (2026-09-02): for every package in `shared/`, all business logic lives in the
shared package. First Principles Thinking (FPT) applies to every fix - see the debugging section above. Mobile and Desktop are dumb consumers - they supply ports (storage, native runtime,
IPC, rendering) and nothing else. That is what "hexagonal architecture" means here. A host file
should read as "wire port A to shared method B". If the other host would need the same function,
copy string, mapping, or rule, it is business logic and it goes to shared. SSOT, SOLID, DRY, SRP,
and Clean Architecture apply to everything we build; a `() => false` policy stub or a duplicated
helper in a host is the tell that a rule leaked out of shared.**

The shared packages are: `@offgrid/analytics`, `@offgrid/artifacts`, `@offgrid/automation`, `@offgrid/capture`, `@offgrid/clipboard`, `@offgrid/design`, `@offgrid/finops`, `@offgrid/memory`, `@offgrid/models`, `@offgrid/pipeline`, `@offgrid/policy`, `@offgrid/rag`, `@offgrid/speech`, `@offgrid/sync`, `@offgrid/ui`, `@offgrid/use`, `@offgrid/vectordb`. Before writing any
model-related condition in `desktop/` or `mobile/`, look for the owner among them. If the rule
exists there, call it. If it does not, add it there with its tests, then call it from both apps.
A check duplicated in an app (a `kind === 'image'` branch, a readiness pre-check before the shared
service has decided the operation, a copied regex, a second memory rule) is a defect even when it
is correct today, because the two copies drift apart tomorrow. Apps keep: platform adapters
(native modules, filesystem, sockets), store wiring, screens, and navigation.
<!-- END GENERATED: shared/CLAUDE.md#debugging-source-of-truth -->
## Architecture & Abstractions (SOLID)

**Design to abstractions, not concrete implementations.** When there are multiple interchangeable implementations of a thing (TTS engines, model backends, providers, storage), the rest of the app must depend on a single interface/service layer - never branch on a concrete type.

**Before every code edit, stop and ask four questions - out loud, in the response:**

1. **Is there enough here to abstract?** Two or more concrete cases handled by the same caller (text vs vision vs image models, Slack vs Mail surfaces, kokoro vs piper TTS) means there's a seam. One case, used once, is not - don't abstract speculatively (YAGNI).
2. **Can we apply SOLID here?** Mainly: does one thing own one responsibility (SRP), and do callers depend on an interface rather than the concretes (DSP)? A `kind === 'x'` / `instanceof` / per-type `switch` in a caller - *especially in the renderer* - is the tell that the decision belongs behind a service.
3. **Are we actually using it?** A mapping or rule must be defined ONCE and reused. If the same kind→modality map, the same routing `if`, or the same capability check appears in two layers (e.g. main process AND renderer), that's duplication, not abstraction - collapse it to a single source of truth and have both sides call it.
4. **Does YAGNI say to stop?** Build only what the current requirement needs. Do not add speculative extension points, policies, state, or compatibility paths for hypothetical callers; reuse the smallest existing seam that solves the observed case.

If the answer to 1 is "no", say so and write the simple version. If "yes", build the seam before piling on the second concrete branch - retrofitting after drift is the expensive path.

- **No leaking implementation details upward.** UI and stores must not do `instanceof SpecificEngine`, check `engineId === 'kokoro'`, or branch on capabilities to decide *how* to do something. Push that decision behind the abstraction (the engine/provider implements it; or a service layer dispatches once). If you find yourself writing `if (engine X) … else …` in a component, the abstraction is wrong.
- **Single uniform entry point.** Prefer one polymorphic method (e.g. `engine.play(text, opts)`) that every implementation satisfies over several mechanism-specific methods (`speak` vs `playFromFile`) that callers must choose between.
- **Service layer between UI and implementations.** Implementations (engines/adapters) are swappable; a service abstracts them and exposes a normalized API + state. Adding a new implementation must require zero changes to UI/store.
- **Dependency Inversion / Liskov:** any implementation must be substitutable through the interface without callers knowing which one is active. Normalize gaps (e.g. an engine that can't report playback position) inside the service, not in the UI.
- Apply the rest of SOLID: single responsibility per module, open for extension (add an implementation) / closed for modification (don't touch callers), segregated interfaces (don't force implementations to stub methods they can't support - model that with the abstraction).
- **Think from first principles and keep a reference architecture in mind.** Before changing a subsystem, know its intended shape: what owns which state and resources, and how the pieces compose. Make changes consistent with that architecture.
- **Fix the seam - never patch around a missing abstraction.** When a subsystem has shared state or resources spread across multiple implementations (e.g. audio playback: the iOS AVAudioSession + AudioContext lifecycle + playback state across the streaming-TTS / file-player / PCM-replay paths), build/extend the *single owning service* and route everything through it. Do NOT add gates, guards, or flags in callers/UI/stores to compensate for the missing owner. Point-patches layered on shared mutable state cause cascading regressions - one fix silently breaks another path - and the subsystem becomes chaotic and flaky. If the owning abstraction doesn't exist yet, that's the work: create it, then migrate every path onto it with no bypass.
- **Migrations to an owning abstraction MUST be backward-compatible / behavior-neutral for existing paths.** When you route existing code through a new service, preserve its exact prior behavior - the refactor should be *additive* (it may fix a missing case), never change a behavior callers depended on. Example: the old TTS/recorder paths re-activated the iOS AVAudioSession on *every* call; making the new session owner "idempotent" silently dropped that re-activation and broke TTS. Verify each migrated path behaves exactly as before, then layer the fix on top.
- **Reactive stores are for UI projection - NOT for coordinating side-effects or owning resources.** Zustand/reactive state is the right tool for rendering; it is the wrong source of truth for imperative coordination (audio session/context, model loads, playback control, any hardware/resource). Most of the audio flakiness came from making imperative decisions (play vs block, which session category) by branching on a reactive store snapshot that several code paths write and desync. Follow a clear presentation separation (MVVM/MVP): the **Service/Model** owns the authoritative state machine + resources + side-effects; the reactive store is a **thin read-only projection** of that service; the **View** observes the projection and dispatches *intents* to the service. Never make an imperative decision (or fire a side-effect) by reading a reactive snapshot that multiple writers can mutate - that is the recipe for the desync/race bugs.
- **State and data MUST NOT live in the presentation layer.** A screen/component/hook (the View) holds NO authoritative state, NO business logic, and NO side-effecting data operations - it observes a service's projection and dispatches intents. Concretely: no retry/cancel/delete/finalize logic, no platform-branched mechanism, no store-mutation orchestration, no "compute the real value from several sources" in a screen or a `useXxxScreen`/`useXxxManager` hook. That logic belongs in the owning **service** (which carries the state machine + permanent logs). If a UI hook is doing the work instead of calling a service, that is the bug - move the work into the service and have the hook delegate. (This is why download retry/remove moved out of `useDownloadManager`/`retryHandlers` into `ModelDownloadService` + its providers.)

## Platform Abstraction (no iOS-only / Android-only bugs)

**A platform-specific bug is the symptom of a leaked platform detail.** With the right abstraction every bug is catchable on both platforms at once - that is the goal. We are writing ONE common layer, not two parallel apps.

- **One typed TS contract per native capability; both Swift and Kotlin must satisfy it.** Downloads, audio session, model load, image gen, STT - each has a single interface the JS calls. A method that exists on one platform but not the other is a contract violation, not an acceptable difference. Make the missing method a *compile error* (the TS interface requires it), never a runtime `"only available on Android"` throw.
- **Never branch on `Platform.OS` to decide HOW to do something.** Branching to choose a *mechanism* (which download path, which retry strategy, which audio setup) is the missing-abstraction smell - push that decision into the native module / a service that dispatches once. Branching for a genuine presentation value (a keyboard event name, a style inset) is fine.
- **Genuine OS capability gaps are declared DATA, not silent divergence.** When one platform truly can't do something (iOS URLSession dies on app-kill while Android WorkManager survives; an engine can't cancel), model it as a capability flag on the object (like `DownloadCapabilities`), normalize the gap ONCE inside the service, and let the UI render from the flag. The gap is then testable - never an `if (ios)` scattered through callers.
- **Contract tests run against the abstraction, so they catch both platforms.** Test the common interface + the capability flags; a single test then guards iOS and Android together. If a test can only be written per-platform, the abstraction is wrong.
- **Native module contract parity is mandatory.** The Swift and Kotlin implementations of a module must expose the SAME method names, the SAME events (names + payloads), and the SAME semantics (persistence, cleanup, error cascading). Contract drift between Swift and Kotlin is the root cause of platform-only bugs - when you touch a native module on one platform, verify/mirror the other side against the shared TS contract.

## Quality Gates run on PRE-PUSH (not pre-commit)

**Commits are intentionally ungated so red-first / work-in-progress tests can land as small commits.**
The full quality gate runs via Husky on `git push` (`.husky/pre-push`), scoped to the files pushed
since upstream:

| Pushed file type | Checks that run automatically (pre-push) |
|---|---|
| `.ts` / `.tsx` / `.js` / `.jsx` | eslint, `tsc --noEmit`, `jest --findRelatedTests`, `npm run depcruise`, `npm run knip` |
| `.swift` | SwiftLint, `npm run test:ios` |
| `.kt` / `.kts` | `compileDebugKotlin`, `lintDebug`, `npm run test:android` |
| `.kt` / `.kts` · `android/` · `package*.json` | **Android build** `./gradlew assembleDebug assembleRelease` |
| `.swift` · `ios/` · `Podfile` | **iOS build** (simulator, `CODE_SIGNING_ALLOWED=NO`) |

**The native builds are a LOCAL pre-push gate, NOT in CI.** The hosted `android-build` CI job hung for
3+ hours on the native C++ builds and was removed; both builds now run on push (scoped above so JS-only
/ docs pushes stay fast). CI keeps lint / typecheck / test / architecture / SonarCloud / CodeRabbit.

**Requirements:**
- SwiftLint: `brew install swiftlint` (skipped with a warning if not installed)
- Android checks require the Gradle wrapper in `android/`; the iOS build needs a booted-or-available
  simulator SDK. Verified locally: `assembleDebug assembleRelease` produces both APKs (~14 min).

**Workflow implication:** follow the Required Development Order above. Live proof comes before new
E2E and integration tests. Production builds come after those tests, and before the GitHub push.
Never bypass the push gate with `--no-verify`. `core.hooksPath` is `.husky/_` (husky v9); there is no
pre-commit hook by design.

## Testing (lean — this is the whole doctrine)

**Tests follow live verification.** Finish every source change first with YAGNI, SOLID, SRP, SSOT,
and DRY. Typecheck and lint the code, then verify the complete journey on the real development
surfaces. Convert the successful live steps to E2E checks. Add targeted integration tests after E2E.

**One rendered integration test per fix. Nothing more.**

- Mount the real screen, arrive via real gestures, assert what the user SEES. Fakes ONLY at the device boundary (`__tests__/harness/`); never mock our own code.
- **While iterating, run ONLY that test's file.** Do NOT run `--findRelatedTests` or the whole suite per fix — the full suite runs once at pre-push (the gate is the safety net).
- **No unit tests required. No coverage thresholds.** If a mockist test (mocks our own code, or asserts `toHaveBeenCalled`) fails, DELETE it — never repair it.
- **NO MOCKS OF OUR OWN CODE. EVER.** Not a service, not a store, not a hook. The two ways this rule
  gets broken by people who have read it:
  - **The boundary drawn too high.** "Loading a model needs the native engine, so I'll fake
    `activeModelService`" — wrong at the second step. `llama.rn` and `react-native-executorch` are the
    native modules and `jest.setup.ts` already fakes both. Everything between the tap and them is ours
    and runs real. If you are faking one of our services because "the native part can't run", find the
    actual native import and fake THAT instead.
  - **Reaching the precondition by writing state.** `store.setState({ field })` proves only that
    something can read a field you set. `store.getState().action(value)` is better and is sometimes the
    honest ceiling for a hook whose contract IS a derivation. The target is the real gesture: render the
    screen, press the thing, let the code that sets the state set it.
- "Show the red" (stash the fix, watch it fail) is optional: do it only for genuinely new behavior, skip it for a clear bug fix.
- Confirm a device fix against the log FIRST — pull only the live-session tail (from the last `===== session start =====`), never the whole file.

## Push = Create PR + Address Review

When the user says "push" (or any equivalent like "ship it", "send it", "push this"), follow this full workflow:

### Before pushing
0. Write tests for any new or changed logic if they don't already exist.
1. Run `npm run lint && npx tsc --noEmit && npm test` - fix any failures before continuing.
2. Commit all staged changes with a descriptive message.
3. Ensure you are NOT on `main`. If you are, create an appropriately named branch first: `git checkout -b feat/...` or `fix/...` or `chore/...` etc.

### Pushing & PR
4. Push the branch: `git push -u origin <branch>`
5. If no PR exists for this branch, create one with `gh pr create`. **Do NOT include "Generated with Codex" or any AI attribution in PR descriptions.**
6. If a PR already exists, update its description to reflect **all commits in the PR** (not just the latest push). Read the full commit history with `git log main..HEAD` and write a coherent description that summarises the entire change set - what it does, why, and how.

### Review loop
7. Wait for Gemini to review the PR (poll with `gh pr checks` and `gh api repos/{owner}/{repo}/pulls/{number}/reviews` until a review appears).
8. Pull down review comments: `gh api repos/{owner}/{repo}/pulls/{number}/comments` and `gh api repos/{owner}/{repo}/pulls/{number}/reviews`.
9. Address every review comment - fix the code, re-run quality gates (lint, tsc, test).
10. Reply to **each** review comment individually using `gh api` (`/pulls/comments/{id}/replies`). Every comment gets its own reply - do not post a single summary comment.
11. Push fixes, update the PR description again to stay coherent across all commits.
12. Report what was changed in response to the review.

## CI Review Loop

The repo has three automated reviewers on every PR. After pushing, loop until all are green:

| Reviewer | What it checks | How to address |
|---|---|---|
| **Gemini Bot** | Code quality, style, logic issues | Read comments via `gh api`, fix code or reply explaining why it's fine, then comment `/gemini review` to trigger a fresh pass |
| **Codecov** | Test coverage thresholds | Add missing tests, ensure new code is covered. Check the Codecov report for uncovered lines |
| **SonarCloud** | Security hotspots, code smells, duplications, bugs | Fix flagged issues - especially security hotspots and duplications. Resolve quality gate failures before merging |

**Workflow:**
1. Push code → wait for all three reviewers to report
2. Pull down Gemini comments, Codecov report, and SonarCloud findings
3. Fix issues: code changes for Gemini/SonarCloud, add tests for Codecov
4. Re-run local quality gates (`npm run lint && npm test && npx tsc --noEmit`)
5. Push fixes, comment `/gemini review` on the PR to re-trigger Gemini
6. Repeat until all three reviewers pass with no blocking issues

## PR hygiene (lean)

- One concern per PR, small diff. Ship the one rendered test that would fail without the change.
- No on-device journey, no self-audit comment, no mandatory ceremony. Multi-agent fan-out is opt-in, only when asked.

---

# On-device testing & verification — the playbook (READ before any device work)

Hard-won; codified so we never re-derive it. Tool-neutral: applies to any coding agent.

## The merge gate (non-negotiable)
A fix touching a **cross-platform capability** MUST be verified on **BOTH a real Android AND a real iOS
device** before its PR merges. "It's shared JS, so it works on both" is a DEFECT assumption — proven
here: the vision fix worked on iOS yet needed separate Android verification. Full gate for every bug PR:
1. Real-boundary integration test (below) — green.
2. On-device e2e on **both** platforms — reproduce the real user flow, confirm via the device log/UI.
3. CI all green: lint, typecheck, test, architecture, android-build, SonarCloud, CodeRabbit.

## Driving the devices yourself (no journey engine)
- **iOS (physical):** drive **WebDriverAgent (WDA) directly over HTTP**. Bring the WDA server up with
  `scripts/ios/launch-wda.mjs` (`WDA_UDID=<hardware-udid>`) — that script is ONLY the WDA-server
  recipe (build-for-testing `generic/platform=iOS`, install via `devicectl`, launch via
  `xcodebuild test-without-building`; serves at `http://<device-LAN-IP>:8100`). Then curl WDA: `POST /session` `{capabilities:{alwaysMatch:{bundleId}}}`,
  `GET /session/:id/screenshot` (base64 PNG), find by `POST /session/:id/element {using:"accessibility id"}`
  → `/click`, type via `/wda/keys` or element `/value`, `POST /session/:id/actions` for a W3C tap.
- **Android (physical):** drive with **`adb` directly** — `adb shell input tap X Y | text | swipe`,
  `adb exec-out screencap -p > f.png`.
- **Prefer accessibility-id / element taps over raw coordinates** — the app exposes testIDs
  (`home-tab`, `models-tab`, `chats-tab`, …). Screenshot after EVERY tap; never blind-tap through
  unknown state.

## Coordinate math
- WDA taps are in **points** = screenshot_px / device_scale (iPhone 17 Pro Max is 3x → points = px/3;
  get exact size via `GET /session/:id/window/size`).
- `adb input` uses the **screen/override resolution** (e.g. 1080x2378); screencap is in those px.
- When the harness shows a scaled screenshot, multiply displayed coords by the stated factor to get
  original px first.

## Getting the fix onto the device
- **iOS:** a device **Debug build embeds the JS bundle** → run `scripts/ios-device.sh`
  (`IOS_DEVICE_ID=<hw-udid>`). It builds `generic/platform=iOS` (NOT `-destination id=…`, which hangs /
  errors 70 on CoreDevice) and installs via `devicectl`. Fix is baked in — **no Metro needed**.
- **Android:** Debug build **loads JS from Metro** → `npx react-native run-android`, plus
  `adb reverse tcp:8081 tcp:8081` and Metro running on the branch. The app defaults to `localhost:8081`,
  which the phone can't reach over WiFi without the reverse.
- **Install downgrade:** `INSTALL_FAILED_VERSION_DOWNGRADE` (Android ignores `-d`) → `adb uninstall <pkg>`
  then install (this **wipes downloaded models** → re-download).
- A **debuggable** build is required for `run-as` log access, the in-app Debug Logs screen, and the
  `__DEV__` file sink.

## Logs — pull them, don't guess
- iOS: `xcrun devicectl device copy from --device <udid> --domain-type appDataContainer
  --domain-identifier ai.offgridmobile.dev --source Documents/offgrid-debug.log --destination /tmp/x.log`.
- Android (debug build): `adb exec-out run-as ai.offgridmobile.dev cat files/offgrid-debug.log`.
- The **file sink flushes lazily** — the file can lag the live log by many minutes. For current traces
  use the in-app **Debug Logs** screen (live in-memory) or force app activity to flush. Grep the
  `[*-SM]` / `[WIRE-*]` markers (e.g. `[WIRE-VISION] initialized:true` proves multimodal loaded).

## Gotchas that cost us hours (do NOT repeat)
- **`timeout` does not exist on macOS** — never use it in bash. Use the tool's own timeout or
  background + poll.
- **devicectl `tunnelState:"disconnected"` ≠ unreachable** — the device is usually still reachable by
  its coredevice id / to Xcode. Probe `devicectl device info details --device <id>`; Xcode seeing the
  device is the real signal, not `list devices` tunnel state.
- **System permission dialogs** (notification access, photo access, Face ID / passcode) silently
  intercept taps and drift the app to the wrong screen. Screenshot after each tap; if the screen isn't
  what you expect, STOP and reassess.
- **Never** enter credentials/passcodes; **never** navigate through the user's private data
  (recordings, photos) beyond the minimum the test needs.
- Keep the device **unlocked / Auto-Lock = Never** — WDA suspends and dies when the phone locks, and the
  device LAN IP can shift on reconnect (re-read the WDA `ServerURLHere` after a relaunch).
- This WDA fork has **no `/wda/shake`** — you can't open the RN dev menu via shake.

## Verification-test doctrine (real boundary, capture-once)
Prove each fix against the REAL external boundary (e.g. **live Hugging Face**), captured once into a
committed fixture and replayed offline — NO mocks of our own code. Template:
`__tests__/integration/models/visionMmprojFromHF.test.ts` (`UPDATE_HF_FIXTURES=1` to refresh from live).

## CI push-gate flakiness
The pre-push jest gate flakes on **parallel-load timeouts** — tests pass in isolation and the failure
count varies run-to-run. **Retry the push**; do not "fix" the flaky test. (`--maxWorkers=1
--workerIdleMemoryLimit`, per the CI notes.)

## Workflow
One bug → one PR → `main`. Sequential; no worktrees, no parallel work. Report status honestly as
**code / wired / verified** — never claim "fixed" until verified on both devices.
