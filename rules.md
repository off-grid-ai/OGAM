# Off Grid Mobile

Follow [the workspace engineering contract](../.codex/ENGINEERING_CONTRACT.md). It takes priority over these repo notes. Keep each change in the smallest existing owner.

- Paid feature code belongs in the private `pro/` submodule. Core uses the existing registration seams. Commit Pro changes in its own repo.
- For UI work, follow `../brand/DESIGN_PHILOSOPHY.md` (the one design philosophy for every Off Grid surface; its Mobile profile owns mobile mechanics) and use `@offgrid/design` tokens. For customer-facing copy, read `docs/brand_tone_voice.md`.
- Keep capture opt-in with a visible recording indicator. Do not publish private device data.
- During device checks, do not enter credentials or passcodes. Open private content only when the changed journey requires it.
- Verify the changed journey on the affected device. For a change that affects both platforms, check iOS and Android before claiming both work.
- Debug builds use `ai.offgridmobile.dev`. Read the in-app Debug Logs or the dev-only `offgrid-debug.log` in the app container when diagnosing device behavior.
- If asked to push, use a branch and PR; do not push directly to `main`.

<!-- BEGIN GENERATED: shared/CLAUDE.md#debugging-source-of-truth -->
> **Generated from `shared/CLAUDE.md` - do not edit this section here.**
> Run `node scripts/mirror-doctrine.mjs` in `shared/` after changing the canonical copy.
> `--check` fails the build when a mirror drifts, so these cannot silently disagree.

## Debugging — reason from first principles

Read the observed behavior and the owning code. Use logs or a live reproduction when needed. Fix the reported cause without assuming that every bug needs a new source of truth or abstraction.
<!-- END GENERATED: shared/CLAUDE.md#debugging-source-of-truth -->
