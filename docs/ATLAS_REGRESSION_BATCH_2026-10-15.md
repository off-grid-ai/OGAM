# Atlas regression audit continuation — October 15, 2026

Branch: `audit/atlas-stability-c20261014` / draft PR #7

## Changes in this batch
- Restored accurate image tests: explicitly select CPU in CI fixtures; do not weaken runtime GPU/NPU no-fallback policy.
- Repaired LiteRT sampler regression mock to supply native AppState, allowing the real temperature-update test to execute.
- Updated native image generation argument assertions (threads and optional LoRA/upscaler flags).
- Updated OpenCL hardware branch tests to mock enumerated native GPU backends rather than inferring OpenCL from a chip name.
- Updated zip download fixture to honor the complete-archive size guard; truncated archives remain rejected.
- Updated web search network-error regression to assert a graceful no-results response.
- Replaced retired Desktop promo and other old marketing checks with current Atlas and encrypted-backup UI checks.
- Corrected encrypted-backup Settings label: project knowledge-base files ARE included in password-protected backups.
- Fixed ChatsListScreen model-picker completion to retain the user's selected private-versus-regular chat mode.
- Added stable chat delete identifiers and test coverage for deleting exactly the selected conversation.
- Extracted ChatsListScreen styles to its own theme module, eliminating obsolete inline styles and reducing component complexity.

## Verification
- Image lifecycle/regression batch: 22/22 tests PASS across 4 suites.
- Native image/OpenCL/download mocks: all PASS across 3 suites.
- LiteRT sampler and tool handlers: PASS.
- Home screen and Settings screen UI tests: PASS.
- Chat list and free-core tools: 43/43 tests PASS across 3 suites.
- TypeScript checked after the theme refactor: PASS.
- ESLint for changed files: no blocking errors in observed targeted runs.
- GitHub Android native compilation/device testing: **not verified in this batch**.
- Full Jest suite **not yet rerun** after the changes; the previous complete measured baseline was 69 failures and 21 skipped. Do not report the project release-ready until a new complete run passes and device restore is tested.
