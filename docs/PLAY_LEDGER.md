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

## Supervisor 21:30 — hand test 11 (build 12, head 77467bef9)
Pass: no crash over five Text/Image/Video/Text cycles; underline tabs; Stop during a model load stops the reply; Stop mid-reply; bare viewer controls. Fail: no Try again after Stop during a load (Resend works); Gallery still has blank tiles that report "loaded"; Video tab and Models sheet boxed, red eject/trash; first send shows bare dots while loading; Downloads names and colours (fixed after this build: `622e7aeb5`, `7752f88ec`).
1. Try again after Stop during a model load.
2. Gallery tiles that draw nothing.
3. One emerald rule on model surfaces (Video tab, Models sheet).

## Supervisor 22:05 — hand test 12 (build 13, head 127370605)
Pass: Try again after Stop during a model load (with "Model loaded" after it), Try again asks again, eject, grey icons on Downloads/Storage/picks, picks on one surface. Fail: five Gallery tiles are pure-white saved images (the viewer shows white too), so the earlier "blank tile" fixes were the wrong cause (`127370605` reverted); speech models in Downloads named "ggml-tiny.en", "tiny", repo ids, and typed "Text"; Downloads 68.8 GB vs Storage 61.19 GB; boxed chat header, empty state, Models sheet rows, "Your videos"; raw tool name "ask_wiki_question".
1. Gallery: why five images saved pure white; mark or hide failed images.
2. Speech model names and kind in Downloads; one "used" figure.
3. No boxes on the chat header, empty state, Models sheet, Your videos; plain tool words.

## Supervisor 22:40 — hand test 13 (build 14, head b8e394299)
Pass: new chat copy and bare icon, the field on Model settings/Storage/Security/Pro/Downloads, Video models one surface, Security, Gallery viewer. Fail: Choose models (from Storage) has no Back and "Skip for Now" lands on Home; the text-model sheet is see-through and its rows boxed; boxed voice-mode mic and "D" badge; Remote servers black switch knob, mono help, slab buttons; Storage boxes; "Use fastest settings" slab; "Pro Active" looks like a button. One unexplained jump to Home on tapping Model settings (not repeated, no crash).
1. Choose models: Back to where it came from, field, header.
2. Models sheet: solid, one surface with hairlines.
3. No box behind the mic and project badge; Remote servers switch and help text.

## Supervisor 23:00 — hand test 14 (build 15, head 4a8cc72c3)
Pass: Choose models header, Back and Not now return to Storage; solid model sheet; local text models one surface; "Whisper Small (English)"; Your videos field, tabs and pill. Fail: Choose models has no header while it loads (about 60 s) and its plans are bordered cards; the sheet hub and remote groups are boxed, a duplicate Selected card and a red Deselect; failed downloads keep file names and "Text"; Downloads 68.8 GB vs Storage 61.19 GB; a stopped answer ends in raw "**Yamuna"; "Searched documents (no passages)" twice.
1. Choose models: header while loading, one quiet retry, plans on one surface.
2. Model sheet hub and remote groups on one surface; no duplicate Selected, no red Deselect.
3. Downloads: plain names on failed and running rows; one "used" figure.

## Supervisor 23:35 — hand test 15 (build 16, head fda6465d4)
Pass: Choose models header while loading, card plans with the chosen fill, Back to Storage; "Whisper Tiny (English)" typed Transcription; folder glyph on New chat; Geist sentences on Home, Settings, Models, Remote servers help. Fail: `e759faf53` took the outline off the real Get Pro button, not the Pro Active status (fixed `a7b269f3b`, tests fail on the broken code); Device information tier text cramped Mono in nested boxes; Downloads error line red Mono, "Downloading 0" with 2 rows; Projects letter badges; Remote servers rows boxed; Models toolbar icons and chips boxed; header mic tinted box; 12 px gutters on Choose models and Projects.
1. Pro outline on the right button (done).
2. Remaining Mono sentences (Downloads error, Device tiers); Downloading count matches rows.
3. No boxes: Projects badges, Remote server rows, Models toolbar, header mic; one 24 px gutter.

## Supervisor 00:05 — hand test 16 (build 17, head 57d3dfd05)
Pass: Pro Active is a plain status; the model sheet hub is one surface; a stopped answer shows "Yamuna" with no raw "**"; Downloads has no "0" count and a Geist error line; Choose models Back returns to Storage. Fail: a late Stop tap lands on the mic that replaces Stop when a reply ends and starts recording (lost behaviour); "Tools it could use" lists raw names (read_wiki_contents, ask_wiki_question); a 2 s bare pause between the hub and the Text sheet; cut quant "Q1_"; Speech reads "Base"; two identical "Bonsai-27B" rows.
1. A late Stop tap never starts the mic.
2. Plain names in "Tools it could use".
3. No gap between the hub and the Text sheet; full quant labels; plain speech name.

## Supervisor 00:40 — hand test 17 (build 18, head c6171e279; the phone cannot reach Metro yet)
Pass: Projects folder glyphs and 24px list gutter, bare voice-mode glyph, Downloads Geist sentences and no "0", Device tiers without boxes, "Whisper Base (English)". Fail: a Stop tap about 1 s after the reply ended still started recording (the 0.7 s grace was too short); Projects header still a slab at 12px (the new search bar was not in this build); Device information without the field, 16px gutter, a border on the chosen tier, overlapping tier ranges; Downloads "Rate unavailable" in Mono, a boxed count, cut "Q1_".
1. A late Stop tap never starts the mic (grace to 1.2 s).
2. Projects header: 24px gutter, no slab.
3. Device information on the field, 24px, ranges that do not overlap.

## Supervisor 01:10 — hand test 18 (build 19, head about 4bb803587)
Pass: Projects and Chats headers on the field at 24px, the new Chats/Projects search (hairline, emerald focus, filters), bare Models toolbar and glyph + word capabilities, Remote servers without "USE", Device information. Fail: a Stop tap 1.0–1.3 s after it left still started recording; Models search keeps a grey edge and no magnifier; Storage and Gallery headers still slabs (fixed after this build, `d09bed742`); Choose models shows five emerald marks; a "32" pill; 16px download icons on the picks.
1. Late Stop: a longer grace (2 s).
2. One search field for Chats, Projects and Models.
3. Choose models: one emerald mark; picks' download targets 44px.

## Supervisor 01:55 — hand test 19 (build 20, head about a5bf4770f)
Pass: Gallery header and scroll, Storage and Model settings headers, Models search (magnifier, hairline, emerald focus), Downloads plain counts. Fail: a late Stop tap still started recording within the 2 s grace (cause: the guard kept the end time in the composer, which remounts as a reply ends; now read from the generation session, `d3d49149a`); About, Project chats, Knowledge base and Edit project off the field (letter badge, shadowed cards, red Delete bar, grey inputs); Image model search "sd" spins over 30 s with no message; "Use fastest settings" slab.
1. Late Stop (fixed at the seam, verify on device).
2. Project screens and About on the field, one surface, 24px.
3. Image search: results or a clear line, never an endless spinner.

## Supervisor 02:40 — hand test 20 (build 21, head about b373638a9)
Pass: the late-Stop guard blocked real recording; the project screen on the field with a folder glyph, tabs under a hairline, chat rows, grey "Delete project"; Knowledge base on the field; Remote servers radios and dim dots; Settings "PRO" label. Fail: a late Stop tap still flipped the composer into "Tap mic to stop" (the gesture locks before start; now the mic rests disabled for 2 s, `1b1a08e1c`); About shadowed cards and coloured icons; Storage boxes and slab; Edit project grey inputs and Title Case. Incident: the supervisor pressed "Delete project" by mistake while aiming for the tab bar, then Cancel; nothing was deleted. Delete now lives in Edit project (`733a734be`).
1. Late Stop: the mic rests (verify on device).
2. About, Storage, Edit project on one surface, 24px, hairline inputs.
3. Delete project out of the tab-bar zone (done).

## Supervisor 03:20 — hand test 21 (build 22, head 1e85c4810)
Pass: a late Stop tap inside the rest changes nothing; the mic works after 2 s; Delete project only in Edit project; Edit project hairline fields; About header; quiet "Use fastest settings"; Storage button and gutter; image search ends with "Search took too long" and Retry. Fail: Default-project chats answer "Based on the codebase…" with facebook/react context ("Name one fruit" gave carrot and dill); Model settings sliders emerald knobs and pills, Title Case labels; Speech models boxed cards, amber Mono banner, grey search; About links in three boxes; Edit project Cancel/Save 24pt; "Start a Chat" Title Case.
1. Stop code context reaching plain chats in the Default project.
2. Speech models, Model settings sliders, About on one surface, one emerald.
3. Edit project Cancel/Save 44pt; local image picks in search results.

## Supervisor 04:15 — hand test 22 (build 23, head 536662561)
Pass: Speech models (quiet line, shared search, one surface per group), Text/Image quiet line, "Start a chat", Edit project 44pt. Fail: a reply after a DeepWiki tool call and a mid-turn "Compacting" streamed out of sight for about 3 minutes (only Stop showed; the answer appeared on Stop) — investigating; raw LaTeX in the answer bubble; slider knob a near-black capsule and values boxed, "Thinking Budget"/"Max Tokens"/"Reset All Settings" title case; the project's Knowledge base tab has its own old empty state; a red trash beside the document toggle. Incident: the supervisor's tap for a tab bar hit "Reset to defaults" on Model settings, then Cancel; nothing reset.
1. Show the reply while it streams (investigating).
2. Maths in the answer bubble.
3. Project Knowledge base tab: the same empty state; slider knob and labels.

## Supervisor 05:10 — hand test 23 (build 24, head f8ba07e2e)
Pass: the answer stays visible while it streams, through a web search and a mid-turn "Compacting…" (fix `f8ba07e2e` holds on device); maths reads "37 × 43 = 1591"; Model settings header Reset, white knob, bare values, "Thinking budget"; Knowledge base empty state; About one surface; bare Image star. Fail: compaction waits about 90 s on dots with no sense of progress; the Knowledge base empty line and document rows lack the 24px gutter; "Finding your answer" sat behind the composer for 10 s; Text tab rows still look like boxed cards.
1. Compaction: progress or speed.
2. Knowledge base gutter; one pill style.
3. Keep the live turn's first line in view above the composer.

## Supervisor 06:35 — hand test 24 (build 25, head 0e78ddf09)
Pass: a reply's first line stays above the composer (dots under 1 s, first words 6–12 s); the answer stays visible while streaming, also after leaving and returning; quiet mic; project gutters. Not triggered: compaction (59% of 8K after 8 turns). Fail: the chat settings sheet (red "Delete Conversation" box, boxed cards, emerald stat numbers, Title Case); Models Text tab picks and the In-use tint; Home "New chat" slab; Stop, + and settings with shadows; Generation details opens behind the composer.
Least desktop-like: Chat settings sheet, Models Text tab, Home.
1. Chat settings sheet: one surface, quiet Delete, sentence case, no emerald numbers.
2. Models Text tab: picks as rows, no tinted row.
3. Composer buttons without shadows; Generation details scrolls into view.

## Supervisor 07:10 — hand test 25 (build 26, head f81ca2ff9)
Pass: flat Send and Stop; replies visible while streaming (first words about 21 s, above the composer); the mic rests after Stop; the Chat settings sheet mostly (quiet Delete, grey stats, sentence-case title). Fail: search fields still shadowed; the big voice mic and voice answer card shadowed; Title Case left ("New Chat", "Image Gallery", "Last Generation:", "Reset to Defaults"); the sheet's "Use fastest settings" and Reset slabs; Models Text picks boxed and rows about 96px; Settings a stack of bordered cards; Home chips boxed.
Least desktop-like now: Models Text tab, Home, Settings.
1. Models Text tab: picks as rows, shorter rows, one kicker style.
2. The last shadows (search fields, voice mic, voice answer card).
3. Home and Settings on one hairline surface; sentence case everywhere.

## Supervisor 07:55 — hand test 26 (build 27, head ae34b2482)
Pass: For this phone as rows (Text, Speech), one label style, flat search fields, flat mics and voice card, "New chat", "Gallery", "Last reply", answer visible while streaming. Fail: older [test] chats hold swapped answers ("Say hi in three words" holds a rivers answer and the reverse; a new chat did not) — investigating; More models rows about 100px; the 2B model's "But wait…" thinking inside the answer; project Back 28pt and unnamed edit/settings icons; "Start a chat" vs "New chat"; Chat settings "Use fastest settings" and Reset still slabs. Incident: a tap near the top opened Slack (a notification banner); nothing touched there.
1. Swapped answers in older chats.
2. More models rows 40–52px.
3. Top-bar icons 44pt and named; one empty-state label.

## Swapped answers in old [test] chats (investigation, 08:30)
Not reproducible on the current code: every save path carries the turn's own conversation, and 80 fuzzed runs (three chats, sends, queue, send-now, Stop, Resend, late tokens, tools on/off) found none. The chats are days old, so an older build or Sync is the likely source; they cannot be repaired (no record of which question made which reply). Hardened: a late turn can no longer end the next turn's session (`generationSession.end(reason, turn)`).

## Supervisor 08:55 — hand test 27 (build 28, head 62bd80db3)
Pass: three-line model rows; project Back/Edit 44pt and named; "New chat" on the empty project; quiet Reset; two new chats back to back each keep their own answer; streaming visible; Stop then send at once streams normally (4.4 s). Fail: Clipboard (bordered boxes, boxed actions, emerald source, red Clear, "Clipboard Sync"); Sync (shadowed cards, four trailing actions with a red trash, mono body text); Device information (boxed cards, tier grid); Storage boxed cards; sheet gutter 16px.
Least desktop-like now: Clipboard, Sync, Device information.
1. Sync: one hairline surface, one trailing action per device, Geist body text.
2. Clipboard: hairline rows, one copy action, grey source, quiet Clear.
3. Device information: facts as rows; the tier as one row.

## Supervisor 09:40 — hand test 28 (build 29, head f5416fd77)
Pass: Clipboard rows, grey source, quiet Clear, "Clipboard sync"; Sync flat cards, grey actions, Geist text; Home, Chats, Models, Projects, Settings, Device information, Gallery; a new answer lands in its own chat. Fail: Sync says "0 of 0 devices saved" while it lists 4 (Home says 5) — a real count bug; three to four trailing actions per device and per server; Remote servers two boxed buttons; Storage "Document search" twice and an emerald bar; a plain question ran a web search (tool choice, as DeepWiki).
Least desktop-like now: Remote servers, Sync, Storage.
1. Sync device count true.
2. Remote servers one main action.
3. Storage: one "Document search" row, a grey bar.

## Supervisor 10:20 — hand test 29 (build 30, head 1b163f05c)
Pass: Storage two rows and grey bar; Remote servers quiet Scan and text Add manually; replies never sit behind the composer (short and long, keyboard open); Models, Chats, Projects, Settings. Fail: Sync heading and list still disagree ("5 of 5 devices saved" over 3 saved + 1 available; Home "5 saved"), "authoritative device roster" jargon; Remote servers scan cannot be stopped and "Scanning" is faint; Model settings is seven collapsed Mono headings with no values. Incident: a Back tap near the top hit a Slack notification and opened Slack; the next tap landed on Slack's Search tab; nothing typed or sent; the dev app was brought back by a WDA launch, and the tap helper now refuses to tap unless the dev app is in front.
1. Sync: one count, what it counts said plainly.
2. Model settings: values visible.
3. Remote servers: stoppable, readable scan.

## Supervisor 02:45 (hand test 30, build at 1c66f1780..5cd6309bf)

Stop scan and closed-section values work. No lost behaviour. Top 3:
1. Sync reclaim names the connected Mac for removal: `meshReclaim` in shared/packages/sync passes `syncDeviceId: ""`, so connected peers are not excluded. Upstream (shared) fix; flagged to Mac.
2. Sync count: "5 of 5 devices saved" over 4 rows (this phone is the 5th, shown only at the top). Say who the 5 are.
3. Model settings: summaries for General, Default system prompt, Text to speech; Video generation onto the shared header (done in 86e04b586, not yet built).
Also: "Scan stopped. Nothing found yet." reads wrong after a stop.

## Supervisor 03:05 (hand test 31, build at 3ba65149e)

Closed rows show values; Stop scan and "This phone and 4 others" pass. No lost behaviour. Top 3:
1. Prompt row says "None" while chat sends the built-in default: use `settings.systemPrompt || APP_CONFIG.defaultSystemPrompt` (chat's own fallback).
2. Chat settings sheet matches Model settings: Transcription and Text to speech values, one name ("Transcription"), 24 pt gutter.
3. Sync reclaim still names the connected Mac (shared, waiting on Mac); "Show Generation Details" to sentence case; Home's Sync row and Sync's count say the same thing.

## Supervisor 03:30 (hand test 32, build at c5f6fb319)

Labels sentence case, sheet Transcription row and gutter pass. Top 3:
1. A blank prompt ("\n") is sent as the prompt while the row says "Built-in prompt": one resolver that trims, used by chat, the OpenAI builder and the debug sheet; save '' for whitespace.
2. Home's Sync row shows the local count ("5 saved") on cold start before the list loads.
3. Projects rows: drop the repeated folder glyph, hide a description equal to the name, add a Mono last-used time. Also: Text to speech value; the sheet header on the 24 pt gutter.

## Supervisor 03:55 (hand test 33, build at 7cce9d642)

Projects rows, "Built-in prompt" and the scan switch pass. No lost behaviour (DebugSheet has no entry point on the phone). Top 3:
1. The five enabled tools (DeepWiki, web) take over "who are you" on a plain turn. This is the user's enabledTools setting; offering tools only when needed is Mac's call (asked).
2. Chat: "_Model loaded…_" shows its underscores; Generation details does not show the system prompt sent.
3. Downloads: size, quant and date on one Mono line; sentence-case chips plus Video; a failed row says why and offers Retry.

## Supervisor 04:25 (hand test 34, build at 765ff4490)

Downloads chips and dates, Text to speech value, sheet gutter and plain Mono notes all pass. No lost behaviour. Top 3:
1. Downloads Speech rows: no date (useVoiceDownloadItems lacks downloadedAt); author "Transcription" vs the "Speech" chip; failed row has no reason and a dead 0% bar.
2. Text to speech value shows the raw voice id ("am_michael"); show the voice's name.
3. Touch targets and names: download chips under 44 pt and no selected state; sheet "Done" 34×16; unnamed icons (downloads, back, sort, filter, quick settings). Chat header on a 16 pt gutter.

## Supervisor 04:55 (hand test 35, build at a4844cf30)

Project purpose line, Speech dates, voice name and icon names pass. No lost behaviour. Top 3:
1. Gallery: no dot field, 4 pt gutter, count twice, white images read as holes, indigo selection. AliveScreen, surface + hairline tiles, 24 pt gutter, emerald selection.
2. Names: attach "+" unnamed; model selector and viewer labels leak glyphs; viewer not modal to a11y.
3. Downloads: failed row and empty bar (fixed in b07b7814c / 8e56f1a13, not yet built); badge "4 in progress" over 1 paused + 1 failed.

## Supervisor 05:20 (hand test 36, build at c12e675e0)

Gallery field, gutter, hairlines, one count; Attach name; chat 24 pt gutter; failed-row copy all pass. No lost behaviour. Top 3:
1. Downloads: stray "0%" on the failed row; Retry named by file; badge "4 in progress" over 1 paused + 1 failed.
2. Names and targets: viewer Info unnamed; model selector and project chip leak glyphs; Speak unnamed; Attach and Chat options 32 pt.
3. White images still read as holes; composer on 12 pt, assistant meta row at 32 pt. Also Settings root Title Case and "PRO" twice; About: Twitter bird, red heart, "Built by Wednesday" twice.

## Supervisor 05:45 (hand test 37, build at d201ba882)

Names, composer gutter, white tiles, failed-row copy, Pro named once pass. No lost behaviour. Top 3:
1. Settings X row still the bird (SettingsCommunitySections); About "Open Source" Title Case; heart footer and Wednesday twice (Mac's call).
2. Real 44 pt boxes, not hitSlop: Attach, Chat options, Speak, chat header Back / Voice mode / Chat settings; message text 4 pt off the gutter.
3. Downloads badge "4 in progress" over 1 paused + 1 failed; wrench named ""; "Delete model" without the name. Settings and Home still stack boxed cards.

## Supervisor 06:15 (hand test 38, build at 9e6be2a6c)

44 pt Back, Chat settings, Attach, Chat options, Speak; composer and meta row unchanged; sheets at 24; model-named Delete; @ glyph; "Open source" all pass. No regressions. Top 3:
1. Header model chip 101x16, sheet Done 34x17, Voice mode (fixed 412c349ae, not yet built).
2. "•••" unnamed; Downloads wrench and Resume not reachable; Models sheet Eject 15 pt, not a button.
3. Reply text at x=28 (fixed dd31472f7); "MODELS", "Eject All Models", "Refresh Models" Title Case; Pro row misaligned; Downloads Delete 37 pt.

## Supervisor 06:45 (hand test 39, build at dc299649b)

Every item in this build passes: header targets 44 and named, reply at 24, Done ink, Models sheet wording, model-row buttons 44 with rows unchanged, Pro row aligned. No regressions. Top 3:
1. "Message actions" is folded into the message's label, not its own button; "•••" ~24 pt. Voice mode overlaps Chat settings by 9 pt.
2. Downloads: Retry/Remove 33 pt, Back 28; Resume and the wrench not in the a11y tree.
3. Models tab: Check for new models and Downloads 28, Sort/Filter/Import 38, picks Download 17. Pro row has no button role.

## Supervisor 07:15 (hand test 40, build at 14cd7cf66)

Message actions its own button, header no overlap, Models tab 44s, Resume and Repair in the a11y tree, Pro row a button: pass. Top 3:
1. Regressions: Speak overlaps Message actions by 13 pt (meta row); Retry/Resume overlap Remove by 13 pt (transferActions has no gap).
2. Icon glyphs leak into a11y labels (Settings rows, Tools it could use); Tools row not a button.
3. Small targets: generation-details-toggle and Tools row 15 pt; Voice tab 37 wide; Home bell and Pro 36.

## Supervisor 07:45 (hand test 41, build at d9654db6f)

Overlaps fixed (meta row, Downloads), picks Download 44. Top 3:
1. The icon a11y default (335ee9931) does nothing on Fabric: RCTParagraphComponentView reads its own text when its label is empty. Revert; label grouped rows explicitly (Settings, Home, Gallery).
2. Reply footer now 123 pt under an 81 pt reply: not calm. One compact row, 44 pt frames pulled back.
3. Appearance buttons glyph-named, 35x31; Home "New chat" 39 pt; Downloads badge vs list.

## Supervisor 08:20 (hand test 42, build at 303353a97)

Settings labels and Appearance radios work; footer quieter (91 pt). Top 3:
1. Regression: the meta row's 44 pt frames (Speak, Message actions) overlap Tools by 11 pt.
2. Glyph labels left: SettingsAnalyticsSection rows, Home swipe delete (""), gallery card and feedback on Home, Models search icon.
3. Appearance selected cell is emerald on a grey track: reads as a second main action; make it monochrome. Gallery Back, Select, tabs under 44.

## Supervisor 08:55 (hand test 43, build at 3876f2f1b)

Home header no overlap, meta row clears the footer, Appearance monochrome, no glyph in fields: pass. Top 3:
1. Small model answers "Name one tree" with tool talk (5 tools always attached). Mac's call, already asked.
2. Appearance row sits in its own 68 pt card, label at x 36 vs rows at x 77: merge into the list as a normal row.
3. Footer toggles 29 pt, overlap 1 pt; Home bell 36; search field has no label and is 32 tall; Gallery card label carries empty glyph parts.

## Supervisor 09:30 (hand test 44, build at 72700f8ac)

Appearance in the list, Home bell and Gallery row, Gallery Back/Select/tabs, search names after typing: pass. Top 3:
1. Tab underline floats 6 pt above the line on Models but sits on it in Gallery: indicator bottom 0, scroller flexShrink 0.
2. Short targets: Your videos Back 28, search clear 17, Chats Select and New 38.
3. Settings: Appearance's leading sun repeats the Light choice; choices end short of the chevron column; Pro row label says "Pro · active" while the screen says "Lifetime · active".

## Supervisor 10:05 (hand test 45, build at 6d7b280b1) — milestone r12

Badge equals the list (2), tab underline on the line, Your videos Back 44, Appearance icon and alignment, search Clear 44, footer no overlap: pass. Top 3:
1. Regression: app-wide small-button minHeight 44 drew Chats "New" as a 44 pt slab. Reverted; small buttons need an invisible 44 pt frame around an unchanged pill.
2. Downloads failed row puts Retry/Delete on their own line with 40 pt of air; footer toggles 29 pt; new-film-go 40.
3. Dark choice box may overhang the card by 2 pt; Chats search filter lags on 1268 chats.
Milestone shots: docs/play/r12-milestone/{settings,downloads,chat}-after.png.

## Supervisor 10:40 (hand test 46, build at 2b9acb8ee) — first-run walk

Chats header compact again, failed row tighter, Models and Settings pass. Top 3:
1. First reply to "What can you do here?" claims Tongyi Lab and a browser; nothing about Off Grid AI. The built-in prompt should say what the app is and does.
2. Downloads failed/paused rows: Retry and Delete still on their own line; put them on the title line.
3. Tab switches take 2 s+ (1269 chats); Chats Select/New 38 pt. Also: attach hides while typing (intended?), Sync row uses "-" not "·", "Multilingual MiniLM L12" is jargon.

## Supervisor 11:20 (hand test 47, build at 6229eb69b)

"I am Off Grid AI, running privately on this phone" (pass); Built-in prompt row, Downloads actions on the title line, Chats search, Sync "·" pass. Top 3:
1. The first answer lists GitHub, web search and URL fetch: the 5 tools on by default. Mac's call (asked).
2. The project sheet opens ~6 s after the tap (1270 chats); a late sheet caught the next tap. Title "Select Project" → sentence case.
3. Paused 0-byte download: drop the bar row and the duplicate "Paused"; search clear shows ~3 s late; Downloads a11y says "2 in progress" with no visible badge.

## Supervisor 11:55 (hand test 48, build at 7267b7842)

Paused 0-byte row tight, Document search copy, "Choose project" (opened in ~1 s) pass. Top 3:
1. Downloads flashes two stale failed Whisper rows for ~2 s before the list settles.
2. Knowledge base row: filename cut by a red "Couldn't sync to OGAD: Mac (Debug)"; black toggle thumbs; toggles not exposed as switches.
3. Project sheet: every letter tile emerald and the chosen row a boxed emerald border. Also: project page has a grey "New chat" and an emerald "+"; "New Conversation" title case; Projects sort order unclear.

## Supervisor 12:30 (hand test 49, build at dce7f8db7)

Project sheet rows pass (third open 0.96 s; first open still ~7 s); KB names full, sync line under the name. Top 3:
1. The project KB tab is ProjectDetailKnowledgeBaseSection, not KnowledgeBaseScreen: its switch still sits inside the row touchable with the old label. One shared row for both.
2. Chat: a streaming reply runs behind the keyboard; the list never scrolls to it; tapping the list does not close the keyboard.
3. Failed KB row lost its size line; long red error still cut. First project-sheet open still ~7 s (cold).

## Supervisor 13:15 (hand test 50, build 51 at 8fa9293e6)

Chat opens at the newest message, reply stays in view while streaming, tap closes the keyboard, KB row and switch, "New chat": pass. Top 3:
1. Downloads: a failed "Whisper Tiny (English)" row stays though the model is on the phone (id mismatch between the store row and the downloaded list).
2. Long press opens the actions sheet AND the native Copy callout; the sent message is out of view ~5 s with the keyboard up.
3. KB red error still cut; status line read twice by VoiceOver; project Chats tab still shows old "New Conversation" titles.

## Supervisor 13:50 (hand test 51, build 52 at a5d22f1be)

Sent message in view at once, reply stays in view, stale Whisper row gone, Downloads steady, KB sync error wraps: pass. Top 3:
1. Regression: a chat opened from Home Recent starts at the oldest message.
2. Weakest screen is the project Knowledge base: red Mono error with "OGAD" jargon and no next step; four emerald switches; a trash per row.
3. Models rows 80 pt; Downloads badge "1 in progress" while the only download is paused.

## Supervisor 14:25 (hand test 52, build 53)

Warm opens land at the newest message from Home, Chats and a project; scroll-up stays; "New chat" titles: pass. Top 3:
1. The FIRST chat opened after launch still lands at an older message (cold, ~5 s to open).
2. A failed transfer line is still red; the incoming-transfer row turns the name red on one line.
3. Knowledge base switch: dark thumb (kept on purpose; noted again).

## Supervisor 15:00 (hand test 53, build 54)

Warm opens land at the newest message; KB failed line grey under an ink name: pass. Top 3:
1. COLD open still lands ~two turns above the newest message (the 250 ms retry is not enough).
2. The transfer line reads "Couldn't send to OGAD: Mac (Debug): transfer failed": the device name carries the app's prefix and debug suffix; no next step.
3. Chats and Recent rows: title is the first prompt, preview is the last reply, so they look mismatched.

## Supervisor 15:35 (hand test 54, build 55 at 67e516a4f)

Cold open lands at the newest message and holds; scroll-up stays with the jump-down chevron; sending keeps your message and the reply in view; warm opens land at the newest: pass. No regressions. Top 3:
1. At 1 s a cold open still shows old turns, then jumps to the end.
2. KB switch thumb dark (kept on purpose) and a trash per row.
3. Recent rows: first prompt as title, last reply as preview (Mac's call). Sync "5 saved" → "4 saved" mid-session (the projection settling).

## Supervisor 16:10 (hand test 55, build 56 at 0495d7ae1)

REGRESSION: two of three chat opens stayed blank (list kept opacity 0 after the style went to undefined; Fabric keeps the last prop). Reply in view and new-chat empty state pass. Fix: set opacity 1 explicitly when settled.

## Supervisor 16:45 (hand test 56, build 57 at 63f1298fc) — milestone r13 (chat scroll)

Blank-chat fixed. Cold open settles at the newest message; warm opens from Home, Chats and a project land at the newest; empty state shows; reply stays in view with the keyboard up. Watch: taps take >1 s while Sync runs; a 16 pt late settle after the cold open.
Milestone shots: docs/play/r13-milestone/{chat-open-after,chat-sent-after}.png.

## Supervisor 17:30 (hand test 57, build 58 at 0586f25a7)

Send with the keyboard up: your message at 0.5 s, reply stays in view (pass). REGRESSION again: two opened chats drawn blank though their rows were in the a11y tree. Hiding the opening list (opacity) is the common factor in both blank runs; removed. Scrolled up with the keyboard down, your message shows at 2 s, not 0.5 s.

## Supervisor 18:05 (hand test 58, build 59 at ac19fff1d)

Blank chats gone (7 opens drawn). Send with the keyboard up in view at 0.5 s (pass). The FIRST cold open again landed at the oldest message and stayed; all warm opens at the newest. Cold-open root cause handed to a device-debugging agent.

## Cold-open root cause (debug agent, 5/5 cold opens pass on device)

FlatList.scrollToEnd computes the end from rows measured so far; on a cold open the first content-size change came before any row was measured, so it scrolled to 0 (oldest). Intermittent because JS timers and rAF stalled 6–22 s after launch while Sync ran. Fix without timers or hiding: scroll to each layout's reported content height; first render starts at the 15 newest rows; re-pin on height change while opening. Commits fcea6bab4..2dc9fd517. Open separately: the Sync JS-thread stall after launch.

## Supervisor 19:30 (hand test 59, cold-open fix build)

Cold open: 1 of 2 runs showed older turns until ~8 s, then landed at the newest; the other run was at the newest by 2 s. History intact (scrolled to the 2:19 first prompt). Warm opens, scroll-up hold: pass. The remaining cold-open delay is the JS thread stalled by Sync after launch (6–22 s, debug agent); the scroll code corrects as soon as JS runs. Next: the Sync launch stall (deferred by Mac; asked).

## Supervisor 20:30 (hand test 60, full screen sweep, build 61) — 18 of 26 fail

Shots: docs/play/r14-sweep/. Pass: Home, Chats, Projects, Knowledge base, Models Text, Downloads. Fail: project page (bare field, folder in title), Models Documents and Document search (label mismatch, tinted first row), Settings lower half (5 cards), Model settings (no surface, emerald text button), Remote servers (cards, cluttered rows), Storage and Device info (cards, numbers not Mono, emerald "Flagship"), Security and Engine updates (box + info box), What we share (12 pt gutter, emerald labels), About (emoji heart, purple logo), Gallery blank tiles, image viewer a modal, every reply 3 meta rows, chat settings sheet flat grey with Delete among settings, chat options menu Title Case mono and gold Pro tools, Tools and Pro tools still the old design.
Worst 5: Pro tools, Tools, What we share, Remote servers, Device info / Storage.

## Supervisor 21:40 (hand test 61, build 62 at 8e7931687) — 9 of 26 pass (was 8)

Pass: Home, Chats, Projects, Knowledge base, Models Text and Documents, Downloads, Settings, Document search, What we share. Worst 5: Pro tools (still old: icon tiles, Active pill, red trash, info box), Chat (3 meta rows per reply, emerald user border), chat settings sheet (Delete among settings), Tools (Title Case names, model-facing descriptions), Project / Model settings / Security / Engine updates (rows without a surface, info boxes; Security and Engine fixed after this build). Review page: https://claude.ai/artifact/RmSC5fdjd8KrRjAoCVKkJp

## Supervisor 23:00 (hand test 62, build 63 at df7de502c) — 13 of 26 pass (was 9)

Newly passing: project, settings-model, security, engine updates. Fail: settings-lower (5 cards), remote servers, storage, device info, about, gallery + viewer, chat (3 meta rows, emerald user border), chat settings sheet (Delete fixed after this build), chat options (gold Pro crown), tools and pro tools. Worst 5: Pro tools layout (sticky info box, one card per tool, model-facing text), chat meta rows, chat settings sheet, gallery, black switch thumbs on 4 screens. Screens take ~2 s to settle.

## Supervisor 00:20 (hand test 63, build 64) — 15 of 26 pass (was 13)

Newly passing: chat settings sheet, Delete at the end; white switch knobs in. Fail: chat (3 meta rows), chat options (gold Pro crown and pill), Pro tools (MCP server cards: letter tile, Active pill, trash), Tools (model-facing footer, "Tools 0" with Knowledge base on), settings-lower (6 unlabelled cards), remote servers (3 icons + radio), device info (tier boxes), storage (4 cards, empty Leftover files), about, gallery + viewer.

## Supervisor 01:30 (hand test 64, build 65) — 16 of 26 pass (was 15)

Newly passing: Tools, Settings (Pro in the list). Pro tools: each MCP server is still a card (logo tile, status pill, separate tools line). Still failing: chat meta rows, chat options count, pro tools, settings-lower, about, device info (tier grid fixed after this build), storage, remote servers, gallery + viewer.

## Supervisor 09:30 (hand test 65, build 66) — 3 of 4 pass, 1 partial

Pass: Remote servers (one chevron; server screen has Test, Update, Remove), Settings community group, Device information tier rows. Partial: Pro tools rows on one surface, but the meta line cuts at "~150 tokens · ht…" so the address never shows (switch not toggled: no [test] server).
Top 3: (1) cards are see-through, the dot grid shows through on Remote servers, Device information, Pro tools; (2) section labels disagree (COMMUNITY uppercase vs "Tools", "MCP servers", "Hardware", "Compatibility"), tier rows indent 8 pt past their label, no hairlines; (3) server form and MCP tools screen off-brand (edge-to-edge fields, faint Update server, a card per tool, token pills, "Disable All" emerald outline).

## Supervisor 09:45 (hand test 66, build 67) — 4 of 6 pass, 1 partial, 1 not in build

Pass: Settings lower (opaque cards, labels above), Device information (tier rows aligned, hairlines), Remote servers, Chat (one time row with Details; panel opens and closes). Partial: Pro tools ("Desktop tools" a black label, its two servers separate cards, host cut on Parallel, info box, trash per row). MCP tools still the old screen (commit landed after build 67). No lost behaviour.
Also: Chats list card still see-through; Pro page labels inside cards.
Gallery blank tiles, root cause: seven generated_images are real 5 KB pure-white 512x512 PNGs from 2026-11-02. Generation saved a failed (blank) output as a success; the gallery draws them correctly.
Top 3: (1) ship the new MCP tools screen; (2) Pro tools: Desktop tools as a quiet label over one surface, full host, trash into the server screen; (3) Details panel on a quiet surface, tool names in words not snake_case.

## Supervisor 10:05 (hand test 67, build 68) — 5 of 7 pass, 2 partial

Pass: MCP tools (rows, Find a tool, one Turn all off), Pro tools (Desktop tools label over one surface, host wraps), chat Details (surface, names in words), Chats list (no dots), Home and Models (no regression). Partial: Storage (Unfinished downloads and Leftover files labels inside cards; raw file name, no size), server form (disabled Update server is pale emerald, about 2:1; Remote media model labels touch the field above). No lost behaviour.
Top 3: (1) server form: room above Remote media labels, readable disabled primary; (2) MCP tool names through toolDisplayName, a backing under the summary line; (3) Storage and Pro page labels above their cards (Pro page fixed after this build).

## Supervisor 10:25 (hand test 68, build 69) — 4 of 5 fixes pass

Pass: MCP tools names in words, Pro tools (no trash; Remove server in its edit sheet, Cancel kept it), Storage labels above, Pro page labels above, Home, Chats, chat, Settings top. Partial: server form (disabled Update server still emerald), Models (three unlabelled icons by search). Fail: Settings lower (emoji heart footer, Anonymous stats card unlabelled). No lost behaviour.
Top 3: (1) disabled primary label grey, Test connection vs Update server weight; (2) MCP tool descriptions for people, tokens to detail, summary backing; (3) drop the emoji heart, label the stats card, label the Models search icons.

## Supervisor 10:50 (hand test 69, full sweep, build 70) — 16 of 26 pass

Fail: chat (Details still Metal/tok/s/q8_0, all Mono), chat options ("Tools 0" with Knowledge base on), models-text (sort shows a bolt), gallery (7 blank images, generation bug, own card), gallery viewer (overlay, routes card), settings-lower and about (emoji heart, purple logo: Mac's call), security and engine updates (labels inside cards), what we share (mixed-case labels). No lost behaviour.
Top 3: (1) tool count agrees everywhere; Details sentence in Geist without engine jargon; (2) labels above cards on Security, Engine updates, What we share; heart and logo wait for Mac; (3) gallery viewer route and blank images (both proposed as their own sessions).

## Supervisor 11:30 (hand test 70, build 71) — not run: iPhone disconnected

Home and one [test] chat loaded, then WDA stopped answering after the Details tap; devicectl lists Mac's iPhone as unavailable and idevice_id finds nothing. Build 71 checks (Details sentence, Tools count copy, sort mark, labels on Security / Engine updates / What we share, Pro tools footnote) wait for the phone.

## Supervisor 12:40 (hand test 71, build 72) — Mac's review notes: 6 of 7 pass, 1 partial

Pass: Home header (icons on the title line), Home carousel (free and Pro, swipes, moves on), chat meta one line with an info icon, chat settings sheet (Project, Model settings, Delete chat; Model settings tabs), Projects (one height, chats / documents / last used), Models (three tiles, On phone, sort mark). Partial: quick settings (see-through menu, Tools 0 while Details lists 5). No lost behaviour.
Top 3: (1) Model settings tabs: one flat surface, no cards in cards, no accordions inside, old copy rewritten; (2) quick settings solid surface, Tools count agrees with Details; (3) chat settings sheet sized to its rows, verified mark aligned on Models, Details sentence capitalised without q8_0.

## Supervisor 13:20 (hand test 72, build 73) — 3 of 5 pass, 1 partial, 1 fail

Pass: quick settings solid, chat Details capital and no cache, no regressions on Home / Projects / Models. Fail: chat settings sheet opened as a bare header (enableDynamicSizing measured the ScrollView as 0); Project and Model settings unreachable from a chat. Fixed after: fixed 42% snap point. Partial: Model settings tabs (Image: example box touching Image steps, "Image Size", Video generation outside the card; Voice: two cards with no gap, dropdown shadow; Text Advanced copy technical).
Top 3: (1) chat settings sheet rows visible (fixed); (2) Image & video and Voice tabs: one card per section, gaps, no dropdown shadow, inline example; (3) Tools count font matches Pro tools.

## Supervisor 13:55 (hand test 73, build 74) — 4 of 4 pass

Chat settings sheet shows Project, Model settings, Delete chat (half empty below); image example inline and "Image size"; a gap between the Voice cards; one face for the quick-settings counts. Watch: a Home recent-chat row did not respond to two taps (Chats tab worked), cause not found.
Top 3: (1) Video generation inside the Image & video card; (2) no dropdown shadows on Voice, a clear state for Read replies aloud; (3) the chat settings sheet sized to its rows without the bare-header bug.

## Supervisor 14:20 (hand test 74, build 75) — project page: 4 pass, 2 partial

Pass: header with New chat beside the purpose, chats under CHATS · 8 at one height with "Last week" / "2 weeks ago", shorter chat settings sheet, Home recent row opens its chat. Partial: "What it knows" card has no label; words differ (file / document, Instructions / SYSTEM PROMPT); 1 file says "from these"; empty project text floats 330 pt below with no CHATS · 0; knowledge base titled with the project name and a duplicate 36 pt "+".
Top 3: (1) knowledge base titled Files, one add; (2) one vocabulary (Instructions, files), "from it" for one; (3) a label on the card, CHATS · 0 above the empty text.

## Supervisor 14:50 (hand test 75, build 76) — 7 of 7 pass

Project page: WHAT IT KNOWS label, CHATS · N (and · 0 with the line under it), "from it" for one file; Files titled with the project under it, one add (44 pt), file not document; Instructions on the edit screen; Video open under its label. No lost behaviour.
Top 3: (1) count-aware empty copy (0 files: "Add a file and chats answer from it"; empty line drops "and files"); (2) one vocabulary: file in the VoiceOver label and Settings, Instructions for system prompt; (3) an IMAGE label to match VIDEO, style names on one line.

## Supervisor 15:35 (hand test 76, build 77, standing hand-tester) — 7 of 8 pass

Pass: Settings one-line rows, Home Sync and Clipboard one line, Downloads underline tabs, verified mark after the name, On phone, Tools package mark, Files add offers A file / Paste text (and empty state has both), project page labels, IMAGE / VIDEO labels, style names on two lines. Fail: IN USE ends 30 pt short of the row end, not in line with On phone. No lost behaviour.
Top 3: (1) IN USE in the action column where On phone sits; (2) Tools count vs switches (explained: counts only with documents); (3) empty Files text centred, Paste sheet says Files not knowledge base.

## Supervisor 16:10 (hand test 77, build 78) — 4 of 5 pass

Pass: IN USE in the action column with On phone, no fill; Documents active row In use at its end; Home feedback a plain row; Files empty text centred, Save to Files. Fail: video style names still mono (the Geist commit came after this build).
Top 3: (1) style names in Geist (in the next build); (2) In use in one case with On phone; (3) Documents: no "download" on a model already on the phone, the arrow says what it does.

## Supervisor 16:45 (hand test 78, build 79) — glass back; 3 of 4 pass

Pass: In use in On phone's face, Documents sizes and marks, style names in Geist. Glass reads well on Settings, Remote servers, Pro tools, Projects, project page, Home lower list and hero. Fail: Home Recent card and the Video settings card are still opaque. Note: field dots can sit inside text lines; Pro tools count 5 (was 7: a server's tools differ with connection state).
Top 3: (1) Recent and Video cards glass; (2) dots near text (accepted with glass, Mac's call); (3) emerald In use contrast at 9 pt.

## Supervisor 17:20 (hand test 79, build 80) — 5 of 5 pass

Remote servers: circle beside both lines, status under the name, amber then red / green dots; Pro tools green dots; Sync " · " and dots; Home Recent and the Video card glass. No lost behaviour.
Top 3: (1) Sync rows: a state icon and a dot say one thing twice; keep the dot; (2) Desktop tools "Connecting…" without a dot; (3) Remote servers read "Not checked yet" for ~15 s while the check runs.

## Supervisor 13:40 (hand test 80, build 81) — 5 of 5 pass, banner gone

No Metro banner on any screen; Sync device-type icons with the state as the dot; Desktop tools amber dot; Remote servers "Checking" then red / green. Glass reads well on the six main screens. No lost behaviour.
Top 3: (1) Desktop tools "Connecting…" never ends while Remote servers says Not answering: one fact, one state; (2) Sync "last seen" a bare timestamp with seconds, wraps to three lines; (3) header hairline only on Projects; Chats first row indented by an image icon.

## Supervisor 15:10 (hand test 81, build 82 via Metro) — 3 pass, 1 untestable, gallery split

Pass: Chats titles at one edge with the media mark on line two; Home title weights; Desktop tools red "Not reachable" (line cut). Sync last seen untestable (no offline row). Gallery images: own screen, Back to grid, a bottom sheet with Animate / Save / Delete and the details. Gallery videos fail: the Videos tab leaves for "Your videos", tiles play inline, the player has boxed buttons, the tile sheet lacks Save and Info. JS now loads from Metro over Tailscale; POST /reload pushes edits in ~15 s.
Top 3: (1) videos get the image viewer: own screen, one sheet with Save, Info, Extend, inside Gallery; (2) Not reachable line fits; (3) no boxed buttons or overlays on video tiles and player.

## Supervisor 15:50 (hand test 82, Metro reloads) — gallery fixed

Videos tab stays in Gallery with a Stories and clips row; Images / Videos switching no longer crashes (numColumns); the video viewer matches the image viewer: dark screen, More opens one sheet with Share, Delete and details; grey play marks; Desktop tools line fits. Fixed after: the video sits centred. Extend lives in Stories and clips.
Top 3: (1) video centred (done); (2) video rows on one glass surface; (3) Pro's film input and Ready cards off the Videos tab.

## Supervisor 16:30 (hand test 83, Home carousel) — layout pass, read as an ad

Twelve cards across the phone, Pro and Mac (Mac's ask: discovery of every feature, outcome copy). Fit and tags pass. Fail: 9 of 12 tagged Pro or Mac and a fast auto-turn read as a rotating ad; three lines rang false. Fixed after: free phone cards lead (untried first within each group), 8 s turn, lines rewritten plain ("Your copies, kept." / "Search what you saw on your Mac." / "Start on your Mac, finish here.").

## Supervisor 17:10 (hand test 84, final sweep, today's JS) — 18 of 26 pass

Fail: project-knowledge (file row bare, not glass; unlabelled switch), downloads (a 3-line row, "Q1_", look-alike Bonsai rows), settings-model (paragraphs under every control), settings-document-search (a copy of Models > Documents), settings-storage (counts and sizes in one column), settings-about (copies Settings' X and Slack rows; blue logo, red heart: Mac's call), settings-lower (stats rows with no line), device information (internal tier values). No lost behaviour.
Top 3: (1) one home per thing: Document search links to Models > Documents, About drops the copied community rows; (2) Storage sizes only, Files on glass; (3) one line per Model settings control, Downloads rows two lines.

## Supervisor 17:45 (hand test 85, recheck) — 6 of 8 pass; a paused download lost

Pass: About (one home for X and Slack), Document search opens Models > Documents, stats rows with a line, Files on glass, Storage values with units, Device tiers in outcomes. Fail then fixed: Model settings lines (shortened again), Downloads facts clipped mid-word (capability tags dropped from Downloads; Models keeps them).
Bug to investigate: the paused "Wan 2.1 (1.3B), FP16" download is gone (Models > Video shows a fresh download icon; Downloads badge gone). Nothing in today's diff touches downloads; most likely cleared when the gallery session installed a main-based build on this phone. A paused download should survive a reinstall.

## Supervisor 16:31 (hand test 86, carousel copy + grey credit) — copy reads as outcomes; carousel does not loop
- Pass: Home field and glass, 9 of 12 card titles, Settings credit, Chats, Projects. No lost behaviour.
- Fail: carousel stops at card 12 and auto-advance jumps to card 6; two card lines clip ("mac-models", "tools"); pips are 6x7 pt; About shows the credit twice (row + footer); six white Gallery tiles; Qwen 3.5 2B refused "Name two colours".
- Top 3: (1) chat default prompt so the small model answers simple asks; (2) carousel loops on swipe and auto-advance, one-line lines, 44 pt pip targets; (3) Talk card: on-phone Whisper first, Mac servers grouped below with hairlines.

## Supervisor 16:48 (hand test 87, hand test 86 fixes) — 4 of 5 pass; the model answers again
- Pass: carousel loops both ways, last card snaps, one-line card lines, timer one card per 8 s and wraps; About credit once, Settings credit kept; Talk sheet lists this phone first; "[test] Name two colours." → "red and blue", 12×7 → 84. No lost behaviour.
- Fail: pip lags one card after a swipe that follows an auto-advance; pip targets 14 pt wide; a tap on a moving card opens the card passing under the finger; Talk sheet rows are bordered boxes with two ways to close; seven Gallery tiles still white.
- Top 3: (1) carousel: active card from scroll position only, wider pip targets, ignore card taps while moving; (2) Gallery: find why tiles are white and fix the cause; (3) Talk sheet: one hairline surface, one close.
- Gallery white tiles (hand tests 86, 87): not a live bug. They are 10 pure-white 512x512 files from 27 Oct and 2 Nov (SDXL GGUF on Metal), made before b7925ae92 (GroupNorm fix) and 6a52571e0 (one-colour image counts as a failed run). Every image since is normal. Left on the phone: Mac's data, never deleted by us.
- Models (hand test 86): "Best" K2 Horizon 7B over "Balanced" Qwen 3.5 9B is the shared rule (quality ranks, not size); no change. The em dashes and clipped lines in model descriptions come from the shared catalog that the phone fetches from Hugging Face (shared/packages/models/src/catalog-chat.ts, 11 dashes). Rewriting them changes desktop too and needs a catalog publish: follow-up outside this loop.

## Supervisor 17:10 (hand test 88, hand test 87 fixes) — 4 of 5 pass
- Pass: pip matches the card after timer and swipes; pip taps jump; a tap on a moving card opens nothing; Talk sheet from a card has only Done, one hairline surface, servers grouped below; from Models, Back returns Models; text picker's remote groups are hairline groups. No lost behaviour.
- Fail: the timer is not reset by a pip tap or by coming back to the app, so the card changes just before a tap (opened the Mac card three times); 2–4 s of bare Home between closing Models and the text picker; text picker gutter 12 pt vs 24 pt in the speech sheet; pip targets 32.7 pt; grey pips blend with the dot field.
- Top 3: (1) restart the timer on any touch and on return, hold a few seconds; (2) remove the gap between Models and the text picker; (3) one gutter across pickers, bigger pip targets.

## Supervisor 17:21 (hand test 89, hand test 88 fixes) — timer and gutters pass; text picker 2.5 s late
- Pass: the card no longer swaps before a tap (two tries); after 16 s away the card holds ~8 s; next advance ~9 s after a swipe; pips read against the field; text, image and speech gutters 24/24 pt; Back from Speech returns Models. No lost behaviour.
- Fail: text picker opens after ~2.5 s of bare Home (image and speech under 0.5 s); carousel keeps advancing behind an open sheet; clipped "Thinks" and "Sees image" tags; RAM estimate changes between opens (~6.7 GB then ~12.1 GB); image picker's red worded "Deselect"; pip targets 33 pt.
- Top 3: (1) remove the text-picker gap; (2) pause the carousel behind sheets; (3) clipped tags, stable RAM estimate, plain Deselect.

## Supervisor 17:35 (hand test 90, hand test 89 fixes) — carousel and RAM pass; text picker still 2.5–3 s
- Pass: carousel held its card for 26 s behind the Models sheet and advanced ~8 s after close; RAM labels stable across 4 opens; image picker's power icon is plain, 44 pt, named; Chats and Settings intact. No lost behaviour.
- Fail: text picker still 2.2–3.2 s of bare Home on every open (also from the Qwen chip, so the stall is in the text picker itself; the header cache was not the cause); repeating 250–375 ms hangs while it is open; tags cut off ("Thin", "Tools ·"); no current-model row or check for the selected-not-loaded Qwen 3.5 2B, and tapping it gives no feedback.
- Top 3: (1) profile and remove the text picker stall; (2) tags never cut off in list rows; (3) mark the selected text model and answer a tap on it.

## Supervisor 17:47 (hand test 91, release pass) — hand test 90 fixes pass; not release-ready
- Pass: text picker up with rows ~0.4 s after the tap (was 2.5–3 s); selected text model checked; no cut tags; remote groups show 5 + Show all; Home, Chats, chat reply ("blue and red", 4.1 s), Projects, Settings, About, Documents. No lost behaviour.
- Fail: image generators tagged "Sees images", RealVisXL called "anime"; Image tab "For this phone" picks change after a second; Speech "Small" card offers download while its row shows trash; Voice banner in warning colour; two check styles; Gallery Videos gutters 16 pt and boxed cards; Downloads tabs differ from Models; Qwen 3.5 4B description touches "On phone"; Video search field has no icon.
- Top 3: (1) correct capability tags on image models; (2) stable Image picks, Speech card and row agree; (3) consistency: Voice banner, one check style, Videos gutters, Downloads tabs.

## Supervisor 17:59 (hand test 92, release pass) — 5 of 6 blockers pass
- Pass: no "Sees images" on image makers, RealVisXL photorealistic; Image picks steady after loading; Speech pick cards and rows never share a name; Voice line plain grey; text picker filled check; Downloads tabs match Models and filter right; Home, Chats, reply in 2.4 s, Projects, Settings, About, Documents. No lost behaviour.
- Fail: Gallery Videos top section (prompt, recent cards, cast) still at 16 pt and boxed; Models Video uses an outline check; Video search field has no icon. Small: Speech names differ between Models and Downloads.
- Top 3: (1) Videos top section on the 24 pt gutter; (2) one filled check on Models Video; (3) search icon on Video.

## Supervisor 18:09 (hand test 93, release pass) — Videos fixed; In-use and gutters still split
- Pass: Gallery Videos all at 24 pt, glass cards; Video tab filled check, search icon, clear works; Speech, Chats, reply in 2.7 s, Projects, Settings, About, Downloads. No lost behaviour.
- Fail: Video search field edge to edge; "In use" still green text on Text, Image and Documents tabs; Library "Your videos" field and cast at 48 pt (double gutter); film page at 16 pt with circled header buttons; Voice search field not the shared one; oversized scrubber thumb. First taps after a screen change sometimes missed (likely WDA; needs a finger).
- Top 3: (1) Video search on the gutter; (2) one filled check for In use on every Models tab; (3) Library single gutter, Voice shared search field.

## Supervisor 18:18 (hand test 94, release pass) — release-ready: yes
- Pass: Video search on the 24 pt gutter; Voice uses the shared search field; "In use" in words on every Models tab; Library field, cast and grid all at 24 pt; Home, Chats, reply in 1.9 s, Settings, Gallery, Downloads. No lost behaviour from this branch.
- Watch (not blocking): 3 first taps dropped and 1–2 s lag after some screen changes (WDA or real, needs a finger); a paused "Wan 2.1 FP16" download row disappeared with no notice (the paused-download loss seen before); Video tab row icons draw late.

## Supervisor 20:24 (hand test 96, composer from Mac's review) — pass with two fixes
- Pass: "Ask anything" on one line; +, settings and assistant all grey, only mic or send filled; the composer grows cleanly while typing; a reply came; image mode reads "Describe a picture" with its styles inside the composer.
- Fixed after: the assistant icon was thinner and smaller than + and settings (now 19 pt, 1.5 stroke); the attach menu now says why Photo is missing when the model can't see photos, since the placeholder no longer says it.
- Open: the photo-attached composer needs Mac's own photo on the phone to check (hand tests never open the library).
