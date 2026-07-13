# Project Instructions

## Repository Layout

**All Pro feature code lives in the `pro/` submodule (its own git repo, `@offgrid/pro`) - not in core.** When changing or adding a Pro feature (e.g. TTS/audio, MCP/tools, and other paid surfaces), edit files under `pro/` and commit/PR them in that repo. Core only wires Pro in through the slot/hook registries; it never imports Pro code directly. Pro changes are a separate branch + PR from core (see `pro/CLAUDE.md`).

## Device Logs (how to see what's actually happening on the device)

**RN 0.83 moved JS `console.log` off the Metro terminal into React Native DevTools, and RN's console never reaches the iOS device syslog.** So `metro` stdout, `idevicesyslog`, and `npx react-native log-ios` (simulator-only) all capture NOTHING from a physical device. Do not waste time tailing Metro for app logs.

Instead, a **dev-only persistent file sink** (`src/utils/debugLogFile.ts`, wired in `App.tsx` behind `__DEV__`) mirrors every `logger.*` line - which is where ALL the state-machine traces go (`[TTS-SM]`, `[GEN-SM]`, `[MODEL-SM]`, `[DL-SM]`, `[ROUTE-SM]`, `[IMG-SM]`, `[MEM-SM]`, `[FAIL-SM]`) - into a file in the app container. Pull it over the cable to read the real trace:

```sh
xcrun devicectl device copy from \
  --device 00008150-000225103CD8C01C \
  --domain-type appDataContainer --domain-identifier ai.offgridmobile \
  --source Documents/offgrid-debug.log --destination /tmp/offgrid-debug.log
```

Then `grep`/read `/tmp/offgrid-debug.log`. The file appends a `===== session start … =====` marker on each launch and is size-capped (rotates, keeping the tail). The in-app **Debug Logs** screen (Settings → Debug Logs) shows the same lines live for quick visual checks. **When diagnosing a device issue, pull this file rather than guessing.**

## Branch Policy

**Never push directly to `main`.** All changes must go through a pull request:

0. Always create a branch specific to the change before committing: `feat/`, `fix/`, `docs/`, `chore/`, `test/`, etc.
1. Push the branch and open a PR - never `git push origin main`.
2. If you find yourself on `main`, create a branch first: `git checkout -b <branch-name>`.

**Merge strategy: ALWAYS a merge commit. NEVER squash (and never rebase-merge).** When merging a PR, use `gh pr merge --merge` (or the "Create a merge commit" button) so the full commit history is preserved on `main`. Do not squash under any circumstances - the small, meaningful per-concern commits are the record and must survive the merge. This applies to both the core repo and the `pro` submodule.

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

**Any change that touches UI (screens, components, styles) must comply with the design system.** Inherit the shared Off Grid design philosophy from **`../brand/DESIGN_PHILOSOPHY.md`** (the source of truth - brutalist/terminal, Menlo mono, emerald accent, tokens in `@offgrid/design`). Platform specifics: **`docs/design/DESIGN_PHILOSOPHY_SYSTEM.md`** + **`docs/design/VISUAL_HIERARCHY_STANDARD.md`**.

- Read `docs/design/VISUAL_HIERARCHY_STANDARD.md` before writing or modifying any UI code.
- Check `docs/design/` for any other relevant design documents.
- Use `TYPOGRAPHY` tokens - never hardcode font sizes or weights.
- Use `COLORS` tokens - never hardcode color values.
- Use `SPACING` tokens - never hardcode margin/padding values.
- Weights must stay ≤ 400 (no bold).
- Never use emojis or emoticons in UI text - always use `react-native-vector-icons` instead. Feather is the default; MaterialIcons is allowed only when Feather lacks a suitable icon (e.g. `whatshot` for trending).
- Never use `lucide-react` or any other icon library - only `react-native-vector-icons`.
- Follow the 5-category text hierarchy: TITLE → BODY → SUBTITLE/DESCRIPTION → META.

## Reuse Before Building

**Before writing any new component, style, hook, or service, search for an existing one and reuse it.** Building a parallel version of something that already exists creates visual and behavioural drift (e.g. a search box that looks different from every other search box).

- For UI: grep `src/components/` and the relevant screen folder for an existing component or shared style (e.g. `ModelCard`, `Card`, `Button`, shared `searchContainer`/`searchInput` styles) before creating your own. Two screens that show the same kind of thing must use the same component.
- For logic: check for an existing hook/service/store action (`grep -rn`) before adding a new one.
- If an existing component is close but not exact, extend it with a prop rather than forking a copy.
- Only build new when nothing fits - and say so in the PR description.

## Architecture & Abstractions (SOLID)

**Design to abstractions, not concrete implementations.** When there are multiple interchangeable implementations of a thing (TTS engines, model backends, providers, storage), the rest of the app must depend on a single interface/service layer - never branch on a concrete type.

**Before every code edit, stop and ask three questions - out loud, in the response:**

1. **Is there enough here to abstract?** Two or more concrete cases handled by the same caller (text vs vision vs image models, Slack vs Mail surfaces, kokoro vs piper TTS) means there's a seam. One case, used once, is not - don't abstract speculatively (YAGNI).
2. **Can we apply SOLID here?** Mainly: does one thing own one responsibility (SRP), and do callers depend on an interface rather than the concretes (DSP)? A `kind === 'x'` / `instanceof` / per-type `switch` in a caller - *especially in the renderer* - is the tell that the decision belongs behind a service.
3. **Are we actually using it?** A mapping or rule must be defined ONCE and reused. If the same kind→modality map, the same routing `if`, or the same capability check appears in two layers (e.g. main process AND renderer), that's duplication, not abstraction - collapse it to a single source of truth and have both sides call it.

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

## Pre-Commit Quality Gates

All quality gates run automatically via Husky on every `git commit`, scoped to the file types you staged:

| Staged file type | Checks that run automatically |
|---|---|
| `.ts` / `.tsx` / `.js` / `.jsx` | eslint (staged only), `tsc --noEmit`, `npm test` |
| `.swift` | swiftlint (staged only), `npm run test:ios` |
| `.kt` / `.kts` | `compileDebugKotlin` (type check), `lintDebug`, `npm run test:android` |

**Requirements:**
- SwiftLint: `brew install swiftlint` (skipped with a warning if not installed)
- Android checks require the Gradle wrapper in `android/`

Before writing new code, ensure tests exist for your changes. If the hook fails, fix the issue and recommit - never skip with `--no-verify`.

## Testing Requirements

Always write **both** unit tests and integration tests for new features and significant changes:

- **Unit tests** (`__tests__/unit/`): Test individual functions, hooks, and store actions in isolation with mocked dependencies.
- **Integration tests** (`__tests__/integration/`): Test how multiple modules work together end-to-end (e.g., service A calls service B which writes to database C). Use mocked native modules but real logic across layers.

Do not consider a feature complete with only unit tests. Integration tests catch wiring bugs, incorrect data flow between layers, and lifecycle issues that unit tests miss.

### Coverage (core AND pro, 100% on new code)

**Coverage must include the `pro/` submodule, not just `src/`.** `jest.config.js` `collectCoverageFrom` collects from `pro/**` whenever the submodule is checked out (gated on `proExists`, so open-core CI without pro still runs). Pro features (TTS/audio, MCP, and other paid surfaces) are exercised by the pro-dependent suites in this repo's `__tests__/` — they must be *measured*, never invisible to coverage. Do not add code to `pro/` without its coverage counting.

**All NEW code ships at 100% - statements, branches, functions, AND lines.** Every new branch/condition (each side of every `if`/ternary/`??`/`||`, each catch, each early return) needs a test that exercises it. Enforce it with a per-file `coverageThreshold` entry at 100 for each new standalone module (core or pro); for a *changed* legacy file, cover every new/changed branch even though the whole file isn't held to 100. New code with an uncovered branch is not done.

**Use mocks very sparingly - a green suite must mean the real thing works, not that a mock returned what it was told.** Mock only what you genuinely cannot run in the test environment (native modules, the network, the device clock). Everything else - the service under test, the stores it writes, the logic across layers - runs for real. A test that mocks the very thing it is asserting (so it would pass even if the implementation were deleted) is worse than no test: it hides the broken behaviour behind a false green. Prefer driving the real class/store/reducer and asserting the observable outcome. When you must stub a boundary, keep the stub dumb (return plain data) and let the real logic on top of it do the work. If a behaviour can only be proven by mocking out the behaviour, that is the signal to test it at a higher layer (integration) or on-device (Provit) instead.

**Design to SOLID with real abstraction layers (not incidental ones).** These are the same rules as the Architecture section above, restated as a standing expectation for every change: one responsibility per module (SRP); callers depend on an interface/service, never on a concrete implementation or a `kind===`/`instanceof`/`Platform.OS`-mechanism branch (DIP); a new implementation (engine, provider, backend) drops in behind the existing seam with zero caller changes (OCP); any implementation is substitutable through the interface (LSP); interfaces are segregated so an implementation never stubs methods it can't support. The abstraction layer must be a genuine owning seam - a service that owns the state machine, resources, and side-effects - not a thin pass-through that leaks the concretes upward. If a fix would add a second concrete branch in a caller, build/extend the seam instead.

**Test every approved behavior change in the same pass.** When iterating (a request, a fix, a tweak you just confirmed), add a test that captures that specific behavior as part of the same change - a regression test that would fail before the change and pass after. This applies to bug fixes (test the exact broken case), new branches/conditions (cover each one), and copy/contract changes that other code or tests depend on. Do not defer tests to "later" or to a separate commit. Then run `npx tsc --noEmit && npm test` and fix any failures before reporting the change done.

### Assert the OUTCOME/INVARIANT, never "the gate was called" (learned the hard way)

We shipped a bug where the voice pipeline held the STT (Whisper) model AND the text model in RAM at once → OOM / forced resend. The unit test that should have caught it did the opposite - it hid the bug behind a false green. The root cause of the *test miss* generalizes; internalize these rules:

1. **A test that mocks a decision function to a fixed verdict CANNOT catch a caller that ignores the verdict.** The old test mocked `makeRoomFor` to always return `{ fits: true }` and only asserted `makeRoomFor` / `loadModel` *were called*. The bug was that the store called `makeRoomFor` but ignored its `fits` result and loaded anyway. Asserting "was called" passes over that exact defect. **Never assert `expect(gate).toHaveBeenCalled()` as the proof a rule holds.** Assert the *consequence* of the verdict: given `fits: false`, the load must NOT happen (`expect(nativeLoad).not.toHaveBeenCalled()`, resident count unchanged).

2. **Test the verdict's FALSE branch, not just the happy path.** A gate/capability/permission check has (at least) two outcomes. A mock pinned to the allow value only ever exercises the allow path. For every `fits`/`canX`/`isAllowed`/`shouldY` gate, write the case where it returns the blocking value and assert the caller actually blocks. Most "we called the gate but didn't respect it" bugs live in the untested false branch.

3. **For resource/residency/lifecycle invariants, drive the REAL owning service and assert the state, not the calls.** The single-model rule ("only one heavy model resident") is an invariant of `modelResidencyManager`. The catching test mocks ONLY the native boundaries (`whisperService.loadModel`/`unloadModel` as flag-flippers, `hardwareService` memory numbers) and runs the REAL residency manager + REAL store, then asserts `getResidents()` / `isResident(key)` - the outcome a user feels (how much is in RAM). Mocking the residency manager itself makes the wiring bug (store vs manager) structurally invisible: the bug lives in the seam between layers, so no single mocked-boundary unit test can see it.

4. **Reproduce the device numbers deterministically.** The bug only manifests when the text model nearly fills the budget so the sidecar can't co-reside. The test pins the budget (`setBudgetOverrideMB(7908)`) and uses the real model sizes from the device log, so it reproduces the exact `fits=false, evict=[]` state - not a platform-dependent approximation (test-env `Platform.OS` picks a different RAM fraction than the Android device, which is why a naive 12GB mock let both models fit and passed).

5. **When a device bug appears, ask "why did the suite stay green?" and fix the test class, not just the code.** If the answer is "a mock returned the value that hid it" or "only the happy path was asserted," that pattern exists elsewhere - grep for the same shape. The fix for the bug and the fix for the blind test ship together.

The smell test before committing any test: **if I delete the implementation under test (or invert the branch), does this test fail?** If a mock would keep it green, the test is asserting the mock, not the behavior - rewrite it to drive the real thing and assert the observable outcome.

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

## Every PR: small, Provit-proven, self-audited (MANDATORY)

This is the standing bar for **every** PR - no exceptions. A PR that is missing the Provit journey or the self-audit comment is not ready to merge.

1. **One concern, small diff.** Extends the small-meaningful-commits rule to the PR level: one subsystem/behaviour per PR, minimal surface. If a change spans two concerns, split it into two PRs.
2. **A Provit E2E journey.** Every PR ships (or updates) a [Provit](../ (its own repo)) journey that (a) exercises the exact user flow the change affects on a **real device** and (b) doubles as the **regression guard** - re-running it proves no regression. Reference the journey name + the run result (pass/fail + device) in the PR. If the change can't be proven on-device by a journey, say why in the self-audit.
3. **A fails-before / passes-after jest test.** At least one unit/integration test that **fails without the change and passes with it** - the exact regression case. Mocks only at genuine boundaries (native/network/clock); never mock the thing under assertion (a green suite must mean the real thing works - deleting the impl must fail the test).
4. **A self-audit comment on the PR** (template below), posted **as a comment alongside the Provit result**. It records the SOLID/abstraction verdict, the mock-honesty check, platform parity, and standards for that specific change - so the audit travels with the PR and the reviewer sees the reasoning, not just the diff.

### Self-audit comment template (paste and fill on every PR)

```markdown
## Self-audit

### SOLID / abstraction
- Enough to abstract? [is there a real owning seam, or is a caller branching on a concrete type / `Platform.OS` mechanism?]
- SRP / DIP: [one responsibility; callers depend on an interface, not a concrete - no `kind===` / `instanceof` / `Platform.OS`-mechanism branch in a View or store]
- Single source of truth: [the rule/map/capability is defined ONCE, not duplicated across layers]
- Verdict: [clean · justified exception (why) · follow-up filed]

### Tests - no false green
- Unit: [what it drives - the REAL class/store/reducer, not a mock of the thing asserted]
- Integration: [the cross-layer path exercised end to end]
- Mocks: [only boundaries (native module / network / clock). Deleting the implementation under test MUST fail these tests.]
- Fails-before / passes-after: [the exact case that fails on `main` and passes here]

### Provit (on-device E2E)
- Journey: `<name>` - proves `<flow>` works on device AND guards regression
- Run: [pass/fail · device] (or: why an on-device journey isn't applicable)

### Platform parity
- iOS + Android: [both covered - genuine gaps modelled as capability-as-data, NOT a leaked `if (ios)` branch. One contract test guards both.]

### Standards (only if UI / copy touched)
- Design tokens (no hardcoded colors/sizes, weights ≤400, no emoji - vector icons only); brand voice (no em dashes, no exclamation marks, no forbidden words, no curly quotes).
```


## Multi-agent operating model (how we build here)

Substantial work is executed by a fleet of parallel subagents orchestrated by the main session - not one linear thread. The standard:

- **Parallel workers, 3 at a time.** Decompose work into worktree-isolated subagents that run concurrently in a rolling window of ~3, each on a DISJOINT file-set so they never merge-conflict. As each lands: review against the engineering standards, merge, run a **local production build gate** (typecheck + tests do NOT catch build/route errors - build before deploy), deploy, verify, then launch the next from the backlog. One agent owns nav/shared-file changes per round; the others avoid them.
- **The gap agent.** Any gap, regression, or "not fully done" is logged to the repo's gaps doc (`docs/GAPS_BACKLOG.md`). A standing gap agent is woken whenever there are gaps: it picks them up, closes them, and marks them resolved with evidence. Gaps are surfaced honestly, never hidden.
- **The QA / platform-integration + docs sweep agent.** After every 3 agent completions, run a sweep agent that (a) verifies the whole platform integrates and works end-to-end (run the integration harness + exercise real cross-service/-surface flows), (b) surfaces any new gaps into the gaps doc, and (c) writes/updates USER-FACING documentation live - how to use / what to do / why / when, per surface - so docs stay current with the build.
- **Merge gate (every merge, non-negotiable):** SOLID + pure logic isolated (unit-testable, zero-IO) separated from I/O; thin handlers; REAL tests exercising real behavior (mocks sparingly); typecheck clean; tests pass; a clean local production build; verify UI by screenshot (vision) and integration by the harness. Nothing is "done" until VERIFIED live, not merely merged.
- **Honesty bar:** report status as a gate (code / wired / verified), never inflate "done." A premature "complete" is a defect.
