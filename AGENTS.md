# Off Grid Mobile Engineering

This file is the canonical instruction source for this repository. Keep it short. The engineering
standard is simple: write clean production code, exercise the real product, and do not make tests
pass by replacing the code they are meant to prove.

## Engineering ethos

- Follow SOLID, DRY, and clear separation of concerns.
- Put each decision and resource under one owner. UI renders state and sends intent; services own
  business rules, side effects, and state machines.
- Depend on stable abstractions. Callers must not branch on concrete engines, providers, or platform
  mechanisms. Add a seam when two real implementations need one; do not abstract speculatively.
- Reuse existing components, hooks, services, stores, and tokens before creating another version.
- Keep production code easy to test through explicit inputs and boundary interfaces.
- Follow the repository ESLint and Prettier configuration. Do not weaken a rule to land a change.

## Testing

No mockist tests.

- Never mock Off Grid code. This includes modules under `src/` and `pro/`, plus our services, stores,
  hooks, components, screens, navigators, parsers, and registries.
- Product behavior is proven with integration tests. Mount the real screen on the real navigation
  stack, reach the state through real user gestures, run the real production path, and assert only
  what the user can observe.
- Fake only a boundary the test environment cannot control or reproduce faithfully, such as a native
  device API, model runtime, remote server, filesystem exhaustion, or OOM. Put the fake at that
  boundary and keep all Off Grid logic above it real.
- Do not use direct store `setState` to manufacture an integration-test precondition. Do not use
  `toHaveBeenCalled` as proof of product behavior.
- Unit tests are appropriate for pure functions and narrow contracts. They do not replace the
  integration test for changed product behavior.
- When behavior is owned by Swift or Kotlin and can be tested there, add XCTest or JUnit coverage.
  Keep a shared contract test when both platforms implement the same capability.
- For a bug fix, prove the regression test fails against the broken code before accepting green.
- New features and significant behavior changes require both focused unit coverage where useful and
  a real integration test for the user journey.

## Repository boundaries

All paid feature code lives in the private `pro/` submodule. Core may expose registries and contracts,
but must not contain or directly import Pro implementations. A Pro change is committed and reviewed
in the Pro repository.

For UI work, read `../brand/DESIGN_PHILOSOPHY.md` and the relevant files under `docs/design/`. Use the
shared typography, color, and spacing tokens. For copy or documentation, read
`docs/brand_tone_voice.md`.

For physical-device diagnosis, use the dev-only `offgrid-debug.log` file exposed in Settings ->
Debug Logs or pull it from the `ai.offgridmobile.dev` app container. React Native logs from a physical
iOS device do not appear in Metro.

## Quality gates

Commits are intentionally ungated. The Husky gate is `.husky/pre-push` and checks the files in the
push range:

- JS/TS: ESLint, `tsc --noEmit`, related Jest suites, dependency-cruiser, and knip.
- Swift: SwiftLint when installed and the iOS tests.
- Kotlin: compilation, Android lint, and the Android tests.
- Changed code also runs the configured Sonar scan.

Before a push, run the relevant tests plus ESLint, Prettier, and TypeScript checks for the files you
changed. Fix failures. Never use `--no-verify`.

## Branch and PR workflow

- Never push directly to `main`. Work on a change-specific `feat/`, `fix/`, `docs/`, `chore/`, or
  `test/` branch.
- Commit small green steps. Use merge commits for PRs; never squash or rebase-merge.
- A request to push means: push the branch, create or update the PR using the repository template,
  wait for Gemini, Codecov, SonarCloud, and CI, then address every finding.
- Reply to each review comment individually with the change made or the evidence for keeping the
  code. Re-run the gates and re-request review until no blocking issue remains.
- Do not merge without the user's explicit approval.
- Do not add AI attribution to commits or PR descriptions.
