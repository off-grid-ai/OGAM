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

## Supervisor 13:08
1. Finish M2: the refusal sheet stacks vertically with one filled main choice; plain copy ("Gemma 4 needs 7 GB; 4 GB is free"); Load Anyway gets a one-line risk note; Stop in dark mode is a white circle, the brightest thing on screen — make it quieter.
2. Paired light/dark shots for new chat, streaming, answer, sheet and picker. Check whether the speaker icon under answers is gone (`r00/11` has it, `r02/02` does not).
3. M3: Geist and Geist Mono, then ListGroup/ListRow and the copy pass.

## r03 type and lists — M3
- **Geist:** bundled on iOS (OffgridFonts pod and UIAppFonts) and Android (res/font families and ReactFontManager). Reading roles use Geist; labels, meta and large numbers use Geist Mono. Commits `8a8b0cf98`, `b12434285`.
- **Lists:** `ListGroup`, plus `ListGroupSeparator` and `listGroupRowEnds` for virtualized lists. Home Recent, Chats and Projects are now one surface with hairlines. Commits `e98c70816`, `c7e7b8d08`.
- **Home:** New Chat uses the new `hero` Button variant (filled emerald). Commit `311f8ace3`.
- **Models:** capability badges name themselves (Sees images / Tools / Thinks), in one tone. Commit `d2622c852`.
- **Offline:** the Mac and the phone no longer share a network. The app runs from the bundle each build embeds; WDA runs over USB (iproxy). Every check is a rebuild.
- **Screen:** `r03-type-lists/01-home-dark.jpg`.

## Supervisor 13:45
1. Weights: 600, 700 and bold are used in about 38 places, but only 200–500 are bundled (the brand allows 300–500). Move them all to 500, and remove the last Menlo (`DocumentPreviewScreen`) and `monospace` (DebugLogs). The hero button's white text on light emerald is about 3.8:1 → use near-black on emerald.
2. Models list into ListGroup rows; plain copy on the memory sheet ("needs 7 GB; 4 GB is free").
3. M4: Home with one hero, Clipboard and Sync after Recent; a fresh-install audit; then the alive layer. Check: "Text 16" is greyed on Home; the swipe action may show past the round corners of the end rows.
- **13:48 device blocked:** the phone has no internet (the hotspot left; office Wi-Fi needs a password I may not enter). iOS cannot verify the developer certificate for a new install ("Unable to Verify App"), so new builds do not open. The Mac is online (10.86.x). Device checks are queued until the phone is online: Home light/dark (hero, order, weights), Chats, Models badges, the memory sheet (plain copy, stacked buttons, contrast).
- **Commits since 13:45:** weights capped at 500 and the onPrimary token (`d23a8f644`), Home order (`5fe3c9d02`), plain GB memory copy (`a9845b11d`). Each was checked with touched-file tests; full suites run in the hygiene thread.

## r04 polish while offline — M3
- **Models:** "More models" is one grouped list, with ModelCard flattened by an optional style (`527369877`). Capability badges are labelled and one tone (`d2622c852`).
- **Device Information:** tier names stay on one line, so "Flagship" no longer breaks (`4a7818dfb`).
- **Switches:** 13 switches move onto one AppSwitch (wrapping the counted Switch). Off reads as off; no white knob in dark mode (`a07f91e79`).
- **Still queued for the device (phone offline):** every visual change since `311f8ace3`.
- **Chat:** an empty chat offers three starter prompts; a tap sends one (`61dffeb30`). Rendered test `starterPrompts.rendered.test.tsx`.

## Supervisor 14:10
1. Starters: show them only when a model is ready (a tap while loading hits "No Model Selected"). They send without the composer's mode. The last row has a double hairline, and the list is narrow, so prompts wrap.
2. Switches: on Android a disabled switch keeps full colour; the on-state knob has low contrast on a 50% emerald track. Models list: incompatible rows fade their own surface (patchy group); the active border is hidden in the grouped list.
3. Next: a fresh-install first run with a best-fit default; Remote Servers as grouped rows; then the alive layer.
- Done: Settings › Search Model is a pushed route (this round).
- **Acted on 14:10:** starters show only when a model can answer, with one hairline at the end and the full width (`c1172a7b4`; `batch2-send` asserts no starters without a model). Switches: disabled dims; on is a near-black knob on full emerald (`2890b6c47`). Open: incompatible rows fade their own surface in the grouped Models list; markdown bold at 500 is weak.

## r05 offline polish (14:40) — M3/M4
- **Models:** an incompatible model fades its content, not its surface, so the grouped list stays solid (`372ea268e`).
- **Remote Servers:** Test / Edit / Remove became three quiet icon buttons on the row's right edge, with their words as accessible names. Tests now find them by label (`bb983d320`).
- **Kept:** markdown bold at 500, inside the brand's 300–500 range.
- **Push gate:** it blocked 4 lint errors from the switch change. Cause: `eslint $F` in zsh linted no files. Fixed in `3ddf7e2f8`, which also locks the OffgridFonts pod. All 78 changed files lint clean.
- **Device:** still offline; every visual change since `311f8ace3` is queued.
