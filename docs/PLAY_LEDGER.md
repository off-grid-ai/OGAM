# OGAM play ledger

Branch `feature/experience-redesign` (mobile and shared, from main). iPhone 17 Pro Max, dev app. Goal: a new user learns Off Grid AI alone and loves it.
Milestones: **M1** P0s · **M2** chat surface · **M3** Geist type, list primitive, copy · **M4** home, fresh-install first run, alive layer.
Each round: expected / found / root cause / change / commit / screenshots.

---

## r00 audit — 2026-11-05 11:50
- **Expected:** every screen judged against oga-ux and the brand direction.
- **Found:** 21 screens in `docs/play/r00-audit/`, findings in `docs/play/AUDIT.md`. Four gaps everywhere: Menlo for all text, stacks of boxes, no alive motion, heavy emerald and red.
- **Decision (Mac):** migrate now in the full order; Geist and Geist Mono on iOS and Android. Plan: `docs/play/DESIGN_MIGRATION.md`.

## Supervisor 12:10
1. Two audit shots prove nothing (`14-chat-dark` is light mode; `18-settings-sync` shows Settings). No fresh-install audit.
2. Move the chat surface before type: most used, no native rebuild.
3. Add a plain-language copy pass (Models, Storage, Device Information); the living background goes last.

## r01 model default — M1
- **Expected:** a new chat on a phone with Gemma 4 picked talks to Gemma 4.
- **Found:** the chat named SmolLM2-135M, and its answer was poor ("Riverside, CA" for a mountain trip).
- **Root cause:** the intent classifier borrows the text engine through the one loader, and the loader recorded every successful load as the chat selection. An overlapping classify, or a refused reload of the chat model, left the classifier selected. The persisted state held `activeModelId` = SmolLM2 and `lastTextModelId` = Gemma 4.
- **Change:** side-task loads pass `utility` and record no selection. A cancelled switch keeps a resident classifier only if the person picked it. `setDownloadedModels` (where every scan delivers the list) repairs a stored classifier selection back to the last real pick. A first repair in the persisted-state merge never ran, because the model list is not persisted. That was a test that seeded the wrong path; it is fixed.
- **Commits:** `8e7bac1e2`, `fc640d160`, `c898d345e`, `8141244d3`.
- **Screens:** before `r00-audit/07-chat-new.jpg`; after `r01-model-default/01-new-chat-after.jpg` ("begin chatting with Gemma 4 E4B").

## r01b failed send — M1, closed
- **Found:** the first send disappeared and left an empty "New Conversation".
- **Root cause:** environment only. The local `shared` checkout was on `feature/scribe-notes` without `video-intent`, so `isVideoRequest` was undefined. In the product, `classifyIntent` already catches classifier failures and falls back to text. A catch-all was tried and reverted: it guarded a case only a broken build can reach, and it could not be tested without mocking our own code.

## Supervisor 12:22
1. Split M1: the classifier leak is done; "best model by default with no pick" is open. It moves to the M4 fresh-install audit, where the real screens are.
2. The lock covers each load but not the whole classify. The selection is now safe; the engine can still swap mid-classify. Logged, not fixed.
3. Every round needs paired same-theme before/after shots plus an answer shot.

## r02 chat surface — M2 (in progress)
- **Header:** read "Models ▾" → now names the model that answers and still opens the manager. Commit `ab63eadf1`. Rendered test `headerNamesModel.rendered.test.tsx`.
- **Stop:** a red circle with no label → neutral (text colour) with the label "Stop reply". Commit `903e8721a`.
- **Device check:** blocked at 12:28. The Mac moved to another network (10.86.x) and the phone is on the OnePlus hotspot, so Metro cannot reach the phone. WDA is back over USB (iproxy 8100).
- **Push:** the pre-push hook failed with no failing test shown. The related-tests run is being checked.
- **Memory refusal:** Gemma 4 E4B needs ~7.0 GB at 8k context and 4–5 GB is free. The chat showed Cancel and a red Load Anyway, with no way forward. One shared sheet (`memoryRefusalAlert`) now leads with **Choose another model** on both chat load paths, keeps the selection on the loaded model, and shows Load Anyway as a normal choice. Commits `2263740df`, `a76561cc1`. Screen: `r02-chat-surface/05-memory-sheet.jpg`. Polish pending: three buttons in a row are cramped (M3).
- **Reverted:** reading the remembered pick in the selection resolver broke "No Model Selected" after a deliberate unload (`batch2-send`). That is existing behaviour, so it is kept.
- **Push gate:** it failed 3 times: once on a half-edited tree, and twice on load timeouts while the Mac also ran device work. Rule from now on: push only from a clean, committed tree, with the Mac idle.

## Time review 13:00 (asked by Mac)
- 45% environment (builds, pods, certificate trust, Metro address, network change), 15% audit, 20% shipped fixes, 20% detours and the push gate.
- Changes: time-box any investigation to 10 min; work only on what shows on the phone; one push per milestone from a clean tree; the supervisor runs every 10 min.
