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

## Supervisor 13:50
1. Starters: show them only when a model is ready (a tap while loading hits "No Model Selected"). They send without the composer's mode. The last row has a double hairline, and the list is narrow, so prompts wrap.
2. Switches: on Android a disabled switch keeps full colour; the on-state knob has low contrast on a 50% emerald track. Models list: incompatible rows fade their own surface (patchy group); the active border is hidden in the grouped list.
3. Next: a fresh-install first run with a best-fit default; Remote Servers as grouped rows; then the alive layer.
- Done: Settings › Search Model is a pushed route (this round).
- **Acted on 13:50:** starters show only when a model can answer, with one hairline at the end and the full width (`c1172a7b4`; `batch2-send` asserts no starters without a model). Switches: disabled dims; on is a near-black knob on full emerald (`2890b6c47`). Open: incompatible rows fade their own surface in the grouped Models list; markdown bold at 500 is weak.

## r05 offline polish (14:00) — M3/M4
- **Models:** an incompatible model fades its content, not its surface, so the grouped list stays solid (`372ea268e`).
- **Remote Servers:** Test / Edit / Remove became three quiet icon buttons on the row's right edge, with their words as accessible names. Tests now find them by label (`bb983d320`).
- **Kept:** markdown bold at 500, inside the brand's 300–500 range.
- **Push gate:** it blocked 4 lint errors from the switch change. Cause: `eslint $F` in zsh linted no files. Fixed in `3ddf7e2f8`, which also locks the OffgridFonts pod. All 78 changed files lint clean.
- **Device:** still offline; every visual change since `311f8ace3` is queued.

## Supervisor 14:08
1. A fresh-install first run that picks a best-fit default model (open since 12:22).
2. Remote Servers and Models as one grouped surface, with the active row marked by an "In use" label or a check, not a border. Server action targets overlapped (fixed `37085e27d`). Faded incompatible text may fail contrast.
3. The alive layer: composer focus glow done (`720784899`); press, entrance and the living background are next.
- **Download auto-select:** with nothing selected, a finished download now selects that model, not `downloadedModels[0]`, which could be the classifier. The test fails on the old code (`8dd6aff94`).
- **Remote Servers:** one grouped list; the active row is marked by its emerald "In use" label, not a border (`b97e1ff18`).
- **Copy:** Storage and Device Information use plain, sentence-case names (`58f55446f`, `6f3919e65`).
- **Correction 14:30:** two Supervisor headings and one round heading carried invented times (14:10, 14:50, 14:40). They now show the real times from the commit log (13:50, 14:08, 14:00). From now on every time comes from `date`.

## Supervisor 14:31
1. Classifier, third path: a queued classifier download restored after a restart (`textProvider.reissue`) always auto-selects, so on a fresh install SmolLM2 can still become the chat model. Storage "Chat models" counts the classifier. One seam: an isClassifierModel check.
2. Copy: "All models" leaves out speech-to-text and voices; "Most the app can use" is ungrammatical. Servers: "In use" and "Use" differ only by colour; mark the active row with a check and the selected state.
3. Fresh-install audit once the phone is online; then the alive layer.
- **Acted on 14:34:** classifier never auto-selected (third path, restored queued download); Storage counts only chat models; two labels fixed; the active server has a check and the selected state.
- **14:40 hold:** visual work is paused until the phone is online. 15 visual commits wait for the device pass (`docs/play/DEVICE_QUEUE.md`); more blind changes would raise the risk of that pass. Next, once online: the device pass, the fresh-install run, the living background, and Home's model-count card.

## r06 device pass and the alive gap (15:52)
- **Hold ended 15:41:** the phone opens builds again; `06ada3e58` installed. Screens in `docs/play/r06-device-pass/` (full-resolution PNG from now on).
- **Home (queue 1):** passes: Geist, filled New Chat, Recent right after it in one surface. Still open: "Text 16" greyed.
- **New chat (queue 2):** this phone has only an image model selected, so the composer reads "Describe an image…" and the text starters showed; a tap would draw a picture. Fixed at the gate: starters need a text model (`7533d507f`; the new test fails on the old code).
- **Mac 15:44:** "it doesn't feel like the alive desktop design." Checked against DESIGN_PHILOSOPHY: no living background, no emerald halo, no press/settle motion, boxed cards. Next is the React Native alive layer, Home first. Mockup for Mac: https://claude.ai/artifact/TS748CG4JNdaWPiRmpEAqu (waits for his go).

## Supervisor 15:52
1. Alive provider on Home: living background, halo on New Chat, press wave, staged entry; Models/Clipboard/Sync/Gallery/feedback into hairline groups that keep every control. Recent subtitles are reading text → Geist, not Mono.
2. New chat: header names the active model; starters full width; one project mention, not two; the boxed empty icon becomes a soft emerald glow. Reshoot light and dark (the 15:44 shot predates `7533d507f`).
3. DEVICE_QUEUE 3–13 on the phone, fresh install (13) first.
- **Mockup risk, acted on:** the Home mockup had dropped the Models collapse chevron, the "Write to us" button, the "Discoverable" sync state and the real latest clipboard item. All four are back in the mockup; the live dot now carries the word "Live".
- **16:02 device, queue 7 and 9:** Chats is one grouped surface with hairlines (pass). Models › More models is one group with labelled, one-tone badges (pass). Both still set reading text (chat previews, model descriptions) in Geist Mono; it belongs in Geist. "For this phone" is still three boxed cards. Swipe-to-delete not yet checked.
- **Open question to Mac:** reuse shared first (`@offgrid/design` tokens in place of mobile's copy in `palettes.ts`, alive motion values moved into `@offgrid/design`, Home headlines from `@offgrid/features`), or build Home first.

## Supervisor 16:13
1. Reading text in Geist, not Mono: chat previews and model descriptions (small, visible).
2. `@offgrid/design` is not a drop-in for `palettes.ts`: it lacks onPrimary, shadows and createElevation, types with `as const`, still names Menlo, and dark error differs (#C75050 vs #b06a6a in tokens.css). Make it a superset before any re-export.
3. "For this phone" as a hairline group; then check swipe-to-delete and the incompatible-row fade on the phone.
- **Folded in (Mac 16:2x, "smaller lift"):** the token merge moves after the look. The alive pass is about a day: theme values in mobile's palette, three new components (LivingField, Halo, press glow), then Home, New chat, Chats and Models.
- **16:22 supervisor item 1 acted on:** chat previews (Chats, Home Recent) and model descriptions used the `meta` role (Geist Mono 10) for reading text; they now use `bodySmall` (Geist 13) (`b59449bd9`; the new test fails on the old code). Device shot waits for the next build.
- **Canvas (Mac 16:1x, "look at the desktop"):** the mockup now copies desktop's LivingField exactly (dot lattice 26 px / 1.25 px, glow and echo at 3.5 s, lit dots near touch, press ring through the dots), desktop's #0a0a0a / #141414 values, the candy primary pill and outlined selected chips.

## r07 Geist reading text (16:33)
- **On the phone:** chat previews on Chats and Home Recent now read in Geist (`r07-geist-reading/chats-after.png`, `home-after.png`; before: `r06-device-pass/07-chats-dark.png`, `01-home-dark.png`). Model descriptions not yet shot.
- **Models (`r07-geist-reading/models-after.png`):** descriptions read in Geist on one line with an ellipsis; dense rows are about 4 pt taller, nothing wraps or clips. Android still to check.

## Supervisor 16:34
1. On Mac's go: desktop's theme values (#0a0a0a / #141414) in `palettes.ts`.
2. Alive Surface, ListGroup and Pressable; LivingField (dot lattice, as desktop) and the candy primary pill.
3. Move Home first (the first thing a new user sees), then Chats, New chat, Models; re-check dense Models rows on both phones.
- Geist change confirmed on screen in both places; risk low (each changed style has one caller). Header clipping in the shots is the dev "Connect to Metro" banner, not the diff.

## r08 alive Home (17:00)
- **On the phone (`r08-alive-home/home-after-1.png`, before `r06-device-pass/01-home-dark.png`):** desktop's dot lattice with a breathing emerald light and echo behind Home (`LivingField`), the hero is desktop's candy pill, Gallery and feedback are one group, and groups let the field show through. Sent to Mac.
- **Seam (Mac: "a few reused components"):** one `cardSurface` style now backs Card, ListGroup and the Models card; Pro's Sync card uses Card, so it follows with no Pro commit.

## Supervisor 17:00
1. Header and tab bar: drop the boxed icon and circle buttons; a translucent tab bar over the field.
2. Clipboard and Sync into the row group; rows 44–52 px with smaller type.
3. LivingField pauses when Home is out of focus or the app is in the background, sized to the screen; hero slimmer with an emerald halo so it is the brightest thing.
- Risks: surfaceGlass on sheets that sit on `surface` reads faint; "Write to us" wraps to three lines.

## r08b desktop page header (17:10)
- **Mac:** "New Chat is such a large button, an eye sore." Desktop's live window: a Mono kicker, a large regular title, a grey line, and the main action as a compact pill ("+ New entry"). Home now does the same; New chat is a pill beside the title (`47c60f774`). The Models row's active types are bright text, not emerald (`2671ef5e3`).
- **Checklist:** `docs/play/DESIGN_CHECKLIST.md` (12 items); every screenshot is scored against it from now on.
- **Tokens (Mac: "the same design tokens on desktop and mobile"):** `@offgrid/design` in shared is now the one source (shared `d89c85e`, `fbd0b1e`): mobile's palette, Geist, the hero and glass tokens, the living-field values, CSS matching TS. Mobile reads it (palette, fonts, type, spacing, radius, living field). Desktop still reads its own fork in `desktop/packages/design`; switching it waits, because desktop's checkout holds another session's uncommitted work.
- **Error red:** shared's CSS had an unshipped muted brick (#b06a6a / #8a4a4a); both apps ship #C75050 / #DC2626, so the one source keeps the shipped red. Mac to decide if the brick should ship.

## Supervisor 17:10 — home-after-3 scored
Pass: 1 alive, 2 depth, 4 main action, 7 lists, 9 icons, 10 tokens. Fail: 3 (emerald Clipboard/Sync icons, bell dots), 5 (bell circled), 6 (Mono sentences in Clipboard/Sync), 8 (Models, Clipboard, Sync, Gallery as four boxes), 11 (inactive "Text" caption contrast). 12 partial.
1. Clipboard and Sync as rows in the Gallery/feedback group, grey icons, Geist meta (Pro's SyncHomeCard).
2. No model: "Get a model" in the header pill slot; the setup card as a row.
3. Bell without its circle; inactive caption contrast. Retake shots without the Metro banner.

## r09 the field answers touch (17:40)
- **Mac:** "alive" means every interaction gets an answer (touch, press, drag, scroll, load), as desktop's does; and no animation work on the JS thread.
- **Built:** `AliveProvider` (listen-only gesture, UI-thread worklets) and `LivingField` answering it: lit dots under a finger, a press ring, scroll drift; breathing as native CSS keyframes. Values in `@offgrid/design` `ALIVE` (shared `d1eb0c1`). Commits `43a05e10c`, `73c396abb` (mask dropped: react-native-svg did not redraw it).
- **On the phone (`r09-alive-touch/`):** 0.25 s after a touch the dots around it light emerald (`home-touch-ring.png`); by 1.15 s with the finger still down the light has gone (`home-touch-held.png`): a held finger should keep it lit. Open.
- **Checklist (home-touch-ring):** 1 alive pass (touch now answered); 8 pass (Clipboard, Sync, Gallery, feedback are one group); 3 pass in this shot (emerald only on New chat, Home tab, lit dots); open: the Models card (Mac: "ugly") → three options on the canvas.

## Supervisor 17:44 — r09 scored
Pass: 2, 3, 4, 6, 9, 10. Partial: 1 (light gone while held), 7 (Sync row 3 lines; "-" vs "·"), 8 (Models card box), 12. Fail: 5 (bell circled; Metro banner), 11 ("Text" caption contrast). No per-frame JS work found.
1. Keep the light while a finger is held → acted on: a cancel holds the light for ALIVE.holdAfterCancelMs, then fades; hidden tabs' fields stay dark.
2. Models card redesign → three options on the canvas, waiting for Mac.
3. Bell without its circle; "Text" caption contrast; shots without the Metro banner.
- Also: the field now sits behind Chats, Projects, Models and Settings.

## r10 desktop's chips (17:54)
- **Mac chose option A.** Home's Models box is now desktop's composer chips (`804a512f0`): the text model named first (emerald when in use), a chip per kind with its count that opens its picker, a trailing "Models" chip for the manager (keeps the `models-summary` testID). On the phone: `r10-models-chips/home-chips.png` (no text model selected on this phone, so "Text 16"). Sent to Mac.
- **Bell:** plain header chrome, no circle (pro `57b3eaa8`).
- **Contrast:** light muted text `#8A8A8A` was 3.4:1 on white; the one token is now `#737373` (4.7:1) for both apps (shared `f6d8776`).
- **Held finger:** the light still fades in WDA's simulated hold; asked Mac to try a real finger.

## Design source and r11 (18:38)
- **Mac:** the one design philosophy is `brand/DESIGN_PHILOSOPHY.md` (approved); everything points there and the other copies go. Mobile's old design docs removed and pointers fixed (`a9d1678e3`); skills oga-ux and hygiene point at brand; desktop and ui-library copies sent to the desktop session (its branch from main). Brand's Mobile profile applied: h2 screen title, 8 px buttons and chips, 24 px screen padding.
- **Supervisor now tests by hand** (drives the phone via WDA as a new user) and judges every screenshot against brand, oga-ux, oga-cpto and the checklist. The loop's prompt is updated to say so.
- **Fixed from hand test 1:** a new chat searched an empty knowledge base and answered "no passages" (`c956c9911`: knowledge search only when the chat or project has a document; the quick-settings count follows the same rule). Confirmed answered in hand test 2.
- **Home:** "Off Grid AI", the promise "Nothing you type leaves this phone." on its own line (/mac-voice), the not-tried showcase (each a tap; hidden once all are tried), chips (`5bed503e0`, `338859012`).
- **Chat:** the living field, desktop's floating composer with an emerald focus glow, Geist input (`9d40f35e7`). Tools-sent list only with generation details on (`f8d2dddcc`).
- **Chats:** one line per chat under Today / Yesterday / This week / Older, with its time and a quiet icon for image or video chats; each day one hairline surface (`464b7233e`). Preview line dropped: waiting on Mac.

## Supervisor 18:38 — hand test 2
1. Chats rows need a quiet detail so same-title chats can be told apart → done (time, kind).
2. Developer text (tool names, "Generation details", "WORKING") behind a developer setting → tools-sent done; "WORKING" and "Using Web search result…" next.
3. Home promise on its own line → done; Models and Settings to 24 px padding and plain hairline lists next.

## Supervisor 18:46 — hand test 3
1. Chats: same-title rows looked alike ("Yesterday" under YESTERDAY) → rows under Today/Yesterday show the clock time (`f1ef0210f`). Open: an opened swipe should close on a tap elsewhere or a scroll.
2. Models and Settings: 24 px padding, one hairline list, emerald only on the one main action; Model Settings copy in plain words. Next.
3. Chat: speed was emerald and the hint dot orange; system lines showed raw underscores → fixed (`f1ef0210f`). Answers say what they did in plain words (`5be36c15a`).
- Hygiene caught my test mistakes (import depth, a missed label, two sources for one setting); the tools-sent row now rides ChatMessage's generation-details prop (`7b74ed44f`).

## Supervisor 18:59 — hand test 4
Pass: Home, Settings top level, Chats clock times. Fail: Settings sub-pages (Model settings, Remote servers, Security, Engine, Storage, Pro, Download manager) still the old boxed look; Models has no clear "In use" mark and unexplained emerald ticks; the weather answer said it could not see live weather although its search found it, and the search step opens to raw JSON; 15 s of running with no progress.
1. Answers use their search results or say none were found; sources in plain words, not raw JSON; progress while tools run.
2. Every Settings sub-page and the Download manager on the one surface with the emerald rules.
3. Models: one clear "In use" mark, one quiet tick for downloaded, "Document search" everywhere.
- Also: a swiped Chats row closes on a tap or a scroll (`7eca8a4da`).

## Supervisor 19:17 — hand test 5
Did not work on the phone: "In use" (the Text list uses the compact card, which has no badge), readable search sources (the step shows the cut text the model got, not valid JSON). Storage shows 0 B while loading, and lists an in-use model's vision projector (mmproj) as orphaned: deleting it would break image reading. Pro's licence section still emerald and Mono. Chat progress now shows.
1. Search step from a tolerant reader (cut results), one "Searched the web" line, a test with a cut result.
2. "In use" in the compact card and on Documents.
3. Storage: never call an in-use projector orphaned; a loading state, not 0 B; plain copy. Then Pro's licence section.

## Hand test 6 and the phone (19:41)
- The retry attached WDA without a bundleId and drove an older Off Grid app on the phone (six were installed), so its findings ("Work done", no field, slab New Chat) were from that app, not the dev build. It sent one [test] chat there and pressed Cancel on a memory sheet; nothing deleted. Mac asked to remove the others: only Off Grid AI Debug (ai.offgridmobile.dev) and WDA remain. The loop's supervisor is now pinned to ai.offgridmobile.dev and waits out the start.
- Slow start: the debug build waits 2 s for Metro, then about 10 s to load its bundle; the rest looks like Sync catching up at boot (Recent showed Oct 29 chats and 1150 for about 70 s). Not proven; needs one start with Sync paused (Mac's setting).
- Fixed since: Pro licence on the card surface (`30b5ba557`); voice bubble plain titles, email tool "Writing the email", nine stale tests (`2555affba`).

## Supervisor 20:13 — hand test 7 (dev app, start about 30 s)
Pass: "In use" on Models, Storage "Measuring…", no vision projector orphaned, readable sources, Security copy. Found: Storage listed a Gemma MTP head and a split model's second part as orphaned (fixed `cf4f4364a`, test fails on old code); Chats rows show no kind icon; Home Recent repeats titles ("You: [test] Find…"); a question with no answer offers no retry; "Searched the web" twice; five emerald source links.
1. Storage orphans: every file a model owns → done.
2. Kind icon on Chats rows; the same-title rule on Home; a retry for an unanswered question.
3. One "Searched the web" line; plain tools line; grey sources.

## Fixes after hand test 8 (20:25)
- Storage: the image model in use is never orphaned (`b5a0a9ba2`).
- A question with no answer shows "Try again" under it (`81752a5db`).
- One search, one row: a result pairs with its call when the model gave no id (`14a3f5d3a`, tests fail on old code).
- Links in answers are text-coloured with an underline, as on desktop (`a05aadb47`).
Next: Model settings plain words, Models Image tab on one surface, Storage polish.

## Supervisor 20:45 — hand test 9 (built-in bundle from 20:26)
Pass: Home, Chats, Settings, one "Searched the web" row, text-coloured links, Try again hidden while running, Resend. Fail: Stop before the first word saves an empty reply, so Try again never shows; Gallery tiles blank and an emerald Images slab; collapsing a step jumps the chat to the end; Models/Storage/tools line (already fixed after this build: `a387e8c83`, `12100a507`, `fb52ab1d9`, `546f52edc`).
1. An unanswered question (empty or stopped reply) shows Try again.
2. Gallery: quiet tabs, no blank tiles, viewer actions grey.
3. Developer lines only with the developer setting; keep the scroll place when a step collapses.

## Supervisor 21:05 — hand test 10 (build 11, head 66f47727a)
Pass: Home, Try again after Stop (model loaded), Try again asks again, "Tools it could use", Image tab one surface, Storage file names and "Leftover files", plain Model settings sliders, Downloads sections. Fail: one SIGABRT opening the Image tab (RCTViewComponentView unmountChildComponentView; not repeated in two tries); Stop while the model loads lets the reply run; New chat boxed icons; red/emerald row icons on Storage video rows and Downloads; Model settings emerald slab and no field; Downloads shows raw .gguf names and "Text" for a speech model.
1. The Image tab crash.
2. Stop during a model load cancels the waiting reply.
3. Grey row actions everywhere; plain names in Downloads.
