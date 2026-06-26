# Project Instructions

## Branch Policy

**Never push directly to `main`.** All changes must go through a pull request:

0. Always create a branch specific to the change before committing: `feat/`, `fix/`, `docs/`, `chore/`, `test/`, etc.
1. Push the branch and open a PR — never `git push origin main`.
2. If you find yourself on `main`, create a branch first: `git checkout -b <branch-name>`.

## Copy & Content Standards

**Any change to website copy, essays, docs text, UI strings, or marketing content must follow the brand voice guide:**

- Read `docs/brand_tone_voice.md` before writing or editing any copy.
- The full quality checklist is at the bottom of that file — run every item before committing content changes.

Key rules that are easy to miss:

| Rule | Wrong | Right |
|---|---|---|
| Proof-first | "fast" | "15-30 tok/s on flagship devices" |
| Privacy as mechanism | "we value your privacy" | "the model runs in your phone's RAM, nothing is sent anywhere" |
| No exclamation marks | "It works!" | "It works." |
| No em dashes | "private — always" | "private - always" |
| No forbidden words | revolutionary, seamlessly, empower, leverage, robust, comprehensive, crucial, pivotal, delve, tapestry, testament, underscore, foster, cultivate, showcase, enhance | use specific, plain words instead |
| No AI slop phrases | "serves as", "stands as", "represents a", "marks a turning point", "it is worth noting" | just say "is" |
| No structural clichés | "Not just X, but Y" / "It's not X, it's Y" | state the thing directly |
| No curly quotes | "private" | "private" |

The emotional arc for all content: **Recognition -> Return -> Freedom**. Name what's been happening, show what's being given back, hand over the capability without condition.

---

## Design Standards

**Any change that touches UI (screens, components, styles) must comply with the design system:**

- Read `docs/design/VISUAL_HIERARCHY_STANDARD.md` before writing or modifying any UI code.
- Check `docs/design/` for any other relevant design documents.
- Use `TYPOGRAPHY` tokens — never hardcode font sizes or weights.
- Use `COLORS` tokens — never hardcode color values.
- Use `SPACING` tokens — never hardcode margin/padding values.
- Weights must stay ≤ 400 (no bold).
- Never use emojis or emoticons in UI text — always use `react-native-vector-icons` instead. Feather is the default; MaterialIcons is allowed only when Feather lacks a suitable icon (e.g. `whatshot` for trending).
- Never use `lucide-react` or any other icon library — only `react-native-vector-icons`.
- Follow the 5-category text hierarchy: TITLE → BODY → SUBTITLE/DESCRIPTION → META.

## Reuse Before Building

**Before writing any new component, style, hook, or service, search for an existing one and reuse it.** Building a parallel version of something that already exists creates visual and behavioural drift (e.g. a search box that looks different from every other search box).

- For UI: grep `src/components/` and the relevant screen folder for an existing component or shared style (e.g. `ModelCard`, `Card`, `Button`, shared `searchContainer`/`searchInput` styles) before creating your own. Two screens that show the same kind of thing must use the same component.
- For logic: check for an existing hook/service/store action (`grep -rn`) before adding a new one.
- If an existing component is close but not exact, extend it with a prop rather than forking a copy.
- Only build new when nothing fits — and say so in the PR description.

## Architecture & Abstractions (SOLID)

**Design to abstractions, not concrete implementations.** When there are multiple interchangeable implementations of a thing (TTS engines, model backends, providers, storage), the rest of the app must depend on a single interface/service layer — never branch on a concrete type.

- **No leaking implementation details upward.** UI and stores must not do `instanceof SpecificEngine`, check `engineId === 'kokoro'`, or branch on capabilities to decide *how* to do something. Push that decision behind the abstraction (the engine/provider implements it; or a service layer dispatches once). If you find yourself writing `if (engine X) … else …` in a component, the abstraction is wrong.
- **Single uniform entry point.** Prefer one polymorphic method (e.g. `engine.play(text, opts)`) that every implementation satisfies over several mechanism-specific methods (`speak` vs `playFromFile`) that callers must choose between.
- **Service layer between UI and implementations.** Implementations (engines/adapters) are swappable; a service abstracts them and exposes a normalized API + state. Adding a new implementation must require zero changes to UI/store.
- **Dependency Inversion / Liskov:** any implementation must be substitutable through the interface without callers knowing which one is active. Normalize gaps (e.g. an engine that can't report playback position) inside the service, not in the UI.
- Apply the rest of SOLID: single responsibility per module, open for extension (add an implementation) / closed for modification (don't touch callers), segregated interfaces (don't force implementations to stub methods they can't support — model that with the abstraction).

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

Before writing new code, ensure tests exist for your changes. If the hook fails, fix the issue and recommit — never skip with `--no-verify`.

## Testing Requirements

Always write **both** unit tests and integration tests for new features and significant changes:

- **Unit tests** (`__tests__/unit/`): Test individual functions, hooks, and store actions in isolation with mocked dependencies.
- **Integration tests** (`__tests__/integration/`): Test how multiple modules work together end-to-end (e.g., service A calls service B which writes to database C). Use mocked native modules but real logic across layers.

Do not consider a feature complete with only unit tests. Integration tests catch wiring bugs, incorrect data flow between layers, and lifecycle issues that unit tests miss.

## Push = Create PR + Address Review

When the user says "push" (or any equivalent like "ship it", "send it", "push this"), follow this full workflow:

### Before pushing
0. Write tests for any new or changed logic if they don't already exist.
1. Run `npm run lint && npx tsc --noEmit && npm test` — fix any failures before continuing.
2. Commit all staged changes with a descriptive message.
3. Ensure you are NOT on `main`. If you are, create an appropriately named branch first: `git checkout -b feat/...` or `fix/...` or `chore/...` etc.

### Pushing & PR
4. Push the branch: `git push -u origin <branch>`
5. If no PR exists for this branch, create one with `gh pr create`. **Do NOT include "Generated with Codex" or any AI attribution in PR descriptions.**
6. If a PR already exists, update its description to reflect **all commits in the PR** (not just the latest push). Read the full commit history with `git log main..HEAD` and write a coherent description that summarises the entire change set — what it does, why, and how.

### Review loop
7. Wait for Gemini to review the PR (poll with `gh pr checks` and `gh api repos/{owner}/{repo}/pulls/{number}/reviews` until a review appears).
8. Pull down review comments: `gh api repos/{owner}/{repo}/pulls/{number}/comments` and `gh api repos/{owner}/{repo}/pulls/{number}/reviews`.
9. Address every review comment — fix the code, re-run quality gates (lint, tsc, test).
10. Reply to **each** review comment individually using `gh api` (`/pulls/comments/{id}/replies`). Every comment gets its own reply — do not post a single summary comment.
11. Push fixes, update the PR description again to stay coherent across all commits.
12. Report what was changed in response to the review.

## CI Review Loop

The repo has three automated reviewers on every PR. After pushing, loop until all are green:

| Reviewer | What it checks | How to address |
|---|---|---|
| **Gemini Bot** | Code quality, style, logic issues | Read comments via `gh api`, fix code or reply explaining why it's fine, then comment `/gemini review` to trigger a fresh pass |
| **Codecov** | Test coverage thresholds | Add missing tests, ensure new code is covered. Check the Codecov report for uncovered lines |
| **SonarCloud** | Security hotspots, code smells, duplications, bugs | Fix flagged issues — especially security hotspots and duplications. Resolve quality gate failures before merging |

**Workflow:**
1. Push code → wait for all three reviewers to report
2. Pull down Gemini comments, Codecov report, and SonarCloud findings
3. Fix issues: code changes for Gemini/SonarCloud, add tests for Codecov
4. Re-run local quality gates (`npm run lint && npm test && npx tsc --noEmit`)
5. Push fixes, comment `/gemini review` on the PR to re-trigger Gemini
6. Repeat until all three reviewers pass with no blocking issues
