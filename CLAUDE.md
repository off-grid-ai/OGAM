# Project Instructions

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

## Branch Policy

**Never push directly to `main`.** All changes must go through a pull request:

0. Always create a branch specific to the change before committing: `feat/`, `fix/`, `docs/`, `chore/`, `test/`, etc.
1. Push the branch and open a PR - never `git push origin main`.
2. If you find yourself on `main`, create a branch first: `git checkout -b <branch-name>`.

**Merge strategy: ALWAYS a merge commit. NEVER squash (and never rebase-merge).** When merging a PR, use `gh pr merge --merge` (or the "Create a merge commit" button) so the full commit history is preserved on `main`. Do not squash under any circumstances - the small, meaningful per-concern commits are the record and must survive the merge. This applies to both the core repo and the `pro` submodule.

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

## Quality Gates run on PRE-PUSH (not pre-commit)

**Commits are intentionally ungated so red-first / work-in-progress tests can land as small commits.**
The full quality gate runs via Husky on `git push` (`.husky/pre-push`), scoped to the files pushed
since upstream:

| Pushed file type | Checks that run automatically (pre-push) |
|---|---|
| `.ts` / `.tsx` / `.js` / `.jsx` | eslint, `tsc --noEmit`, `jest --findRelatedTests`, `npm run depcruise` |
| `.swift` | `npm run test:ios` |
| `.kt` / `.kts` | `npm run test:android` |

**Requirements:**
- SwiftLint: `brew install swiftlint` (skipped with a warning if not installed)
- Android checks require the Gradle wrapper in `android/`

**Workflow implication (TDD / adversarial red-first):** write a failing test, commit it red (commit is
free), then drive it green; the branch must be green before `git push` (the gate blocks a red push).
Never bypass the push gate with `--no-verify`. `core.hooksPath` is `.husky/_` (husky v9); there is no
pre-commit hook by design.

## Testing (lean — this is the whole doctrine)

**One rendered integration test per fix. Nothing more.**

- Mount the real screen, arrive via real gestures, assert what the user SEES. Fakes ONLY at the device boundary (`__tests__/harness/`); never mock our own code.
- **While iterating, run ONLY that test's file.** Do NOT run `--findRelatedTests` or the whole suite per fix — the full suite runs once at pre-push (the gate is the safety net).
- **No unit tests required. No coverage thresholds.** If a mockist test (mocks our own code, or asserts `toHaveBeenCalled`) fails, DELETE it — never repair it.
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
- No Provit journey, no self-audit comment, no mandatory ceremony. Multi-agent fan-out is opt-in, only when asked.
