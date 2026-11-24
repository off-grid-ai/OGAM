# Onboarding: engineering plan (graph engineering)

Product spec: [onboarding-spec.md](onboarding-spec.md). Feature list: [feature-map.md](feature-map.md).
Status: plan only. Nothing is built. Calls C1–C7 decided 2026-11-17 (recommended on each). Guide media and Ask added 2026-11-18 (steps 12–18, calls C8–C10 open). Knowledge-base sweep added 2026-11-18 (steps 19–23, standing). Waits for Mac's go to build.

## What you get, in pictures

Concepts, not final screens. The text on each is what the build ships.

**1. What do you want to do?** Pick groups. Chat is picked for you.

| Mobile | Desktop |
|---|---|
| ![](v2/m1-groups.png) | ![](v2/d1-groups.png) |

**2. Which ones?** Pick the features inside your groups. Pro features show a muted PRO tag and stay pickable.

| Mobile | Desktop |
|---|---|
| ![](v2/m2-features.png) | ![](v2/d2-features.png) |

**3. How it works.** The guide shows only what you picked. Then "Set up my models" downloads only what those picks need.

| Mobile | Desktop |
|---|---|
| ![](v2/m3-guide.png) | ![](v2/d3-guide.png) |

**4. A narrated tour of each feature.** Screenshots with emerald marks drawn on them, a caption and a voice-over. Press play, or step through.

| Mobile | Desktop |
|---|---|
| ![](v3/m4-tour.png) | ![](v3/d4-tour.png) |

**5. Clips in the full player.** Voice-over, captions, chapters, speed, picture in picture and full screen.

![](v3/d5-clip.png)

**6. Ask grows with your text and listens.** Long questions stay readable. The mic works like Chat's.

| Mobile | Desktop |
|---|---|
| ![](v3/m5-ask.png) | ![](v3/d6-ask.png) |

## The ripple (change map)

`onboarding` is not a concept in the change map yet. The change touches four concepts that are:

| Concept | Places the plan touches | Check that exists |
|---|---|---|
| guide | desktop `FeatureGuide.tsx`, `guide/guideKnowledge.ts`, `guide/guideMedia.ts`, `main/guide-ask.ts` | 2 test files, hand-test #207, #208 |
| models | only the hand-off into model setup: mobile `AutoSetupScreen.tsx`, desktop model gate in `App.tsx`. No catalog change. | 50 desktop + 135 mobile test files (run only the touched ones) |
| licensing | read-only: the onboarding asks the existing entitlement; key entry and pairing reuse current screens | 18 Mac hand-test rows (#1, #2 apply) |
| analytics | new `onboarding_picks` event and 3 flow steps on both apps | 9 desktop + 16 mobile test files; shared analytics has 0 tests |

Plus the places with no concept yet: mobile `OnboardingScreen.tsx`, `navigation/AppNavigator.tsx`, `stores/appStore.ts` (+ migrations), `bootstrap/hookRegistry.ts` (`onboarding.additionalSlides`), mobile/pro slide registration, desktop `components/Onboarding.tsx`, `App.tsx` gate, `pro/proCatalog.ts`, and `shared/packages/features`.

**What makes it harder**
- `features.json` keys are a contract: the apps, the website, Signals, Argus and `scan.py` read them. Changes must be additive.
- desktop/pro and mobile/pro licensing have no automated tests.
- Guide media exists for about 20 features; the picks need about 40.
- On mobile no model exists during onboarding, so the guide's Ask box cannot answer yet.
- This branch (`feature/scribe-notes-analytics`) holds other work, and its last commits touched the onboarding Boost slide.

**Collisions:** do not run alongside other model-catalog or onboarding work. Use one new git-flow branch in every repo: `feature/onboarding-picks`.

## Principle checks on the graph

| Check | Result |
|---|---|
| SSOT | Groups, features, Free/Pro, platforms, model kinds and guide copy all come from `@offgrid/features`. The desktop `proCatalog` and `guideKnowledge` copy become readers, so there is no second writer. |
| DRY | One pure function per rule in shared (see step 2); both apps call it. No copy in the apps. |
| SRP | Shared: data + rules. Apps: screens and storage. Pro: registers its Pro features as data, not screens. |
| No backward arrow | shared → app → Pro holds. Pro stops pushing slides into core; core reads Pro features from shared. |
| Existing breaches (calls, not refactors) | Feature copy lives in 3 places today (`features.json`, `proCatalog.ts`, `guideKnowledge.ts`), and Tasks is Pro there but Free in fact. |

## Status (2026-11-18)

Mac, 2026-11-18: after onboarding "the sidebar doesn't change for me. Home doesn't change for me", and "a good onboarding would then keep the other ones closed in the menu". So the picks now shape the app, on both:

| What | Desktop | Mobile |
|---|---|---|
| Steps 0–4 (shared data, onboarding screens) | done | done (slides lead into groups → features → how it works) |
| Step 5: model setup checks what the picks need | done (SetupPanel) | done (AutoSetup) |
| Picks lead the app | "Your picks" leads the sidebar, other sections start closed; opens on the first pick | "Your picks" leads Home |
| Step 10: Settings → What you use | done; the menu follows at once | done; Home follows at once |
| Pick rules in one place | `@offgrid/features` (clean, toggle group, toggle part, toggle from Settings) | same |
| Recommendations from the catalog JSON | setup + Models screen; Bonsai listed, never forced | already on the catalog pool |

Open: step 8 (Pro's Sync slide into shared), step 9 (analytics events), step 11 (devices), 12–18 (guide media), 24–27.

## Steps, in order

Each step is one commit (or a few small ones). It ends when its check passes, after 2 failed tries, or after a round with no progress. The last two stop and ask Mac.

| # | Repo | Change | Check |
|---|---|---|---|
| 0 | desktop | Add an `onboarding` concept to `CONCEPTS` in `scripts/change-map/scan.py` with the places above. | `scan.py --plan onboarding` lists them |
| 1 | shared | `features.json`: add `intent` (the 7 onboarding groups) and `parts` (the Ys: id, name, does, tier, platforms, model kinds, 3 steps, media id) beside the existing fields. Existing keys and `group` stay as they are. | new tests in `shared/packages/features/test`; every existing key unchanged |
| 2 | shared | Pure rules in `@offgrid/features`: `onboardingGroups(platform)`, `partsFor(groups, platform)`, `modelKindsFor(picks)`, `guideFor(picks, platform)`. | unit tests on real data, both platforms, Free and Pro |
| 3 | desktop | `guideKnowledge.ts` and `proCatalog.ts` copy read from shared. The guide page looks and behaves as today. Tasks shows Free. | guide tests; hand-test #207, #208 |
| 4 | desktop | `Onboarding.tsx`: 3 steps (groups, features, how it works). It keeps everything in the spec's "Nothing is lost" table: analytics opt-in, Pro price and key entry, pairing, QuickConnections, local or remote, step resume. Picks persist. | Onboarding tests: each step, Back and Forward, resume, skip, Free and Pro |
| 5 | desktop | The model gate takes `modelKindsFor(picks)`. With no picks (skipped), it does what it does today. | touched gate tests; Mac run from a fresh profile |
| 6 | mobile | New stack screens `OnboardingGroups`, `OnboardingFeatures`, `FeatureGuide`. They replace the slides; `AutoSetup` takes the model kinds. Picks go in `appStore` with a migration. Users who already finished onboarding never see it again. | screen tests on real store state; migration test |
| 7 | mobile | The mobile guide page (shared data, Ask box disabled with one line until a model exists). It is reachable from Settings too. | screen test; iPhone + Android run |
| 8 | mobile/pro | Pro's Sync slide and voice tile become Pro features in shared; stop registering `onboarding.additionalSlides` only after step 6 is live. Bump the `pro` pointer. | Pro build on both phones; Pro features show with Pro on |
| 9 | both | Analytics: `onboarding_picks` (groups, features, skipped step) and the flow steps `groups_shown`, `features_shown`, `guide_shown`, opt-in only. | touched analytics tests; a PostHog EU event from a test build |
| 10 | both | Settings → "What you use": change the picks later. | screen tests |
| 11 | devices | Hand-test on iPhone, Android and Mac from a fresh install and from an upgrade. Shoot every changed screen. | hand-test rows added for onboarding |

### Guide media and Ask (added 2026-11-18, spec: "Guide media and Ask")

Change map `--plan guide`: shared `product-guide.ts`; desktop `FeatureGuide.tsx`, `guide/guideKnowledge.ts`, `guide/guideMedia.ts`, `main/guide-ask.ts`; mobile `GuideScreen/*` (6 files), `services/guideAsk.ts`. It has no hand-test rows yet. Add them before step 18.

| # | Repo | Change | Check |
|---|---|---|---|
| 12 | shared | Each part from step 1 gets `tour`: steps of `{ caption, narration, still, marks[] }`. A mark is `{ kind: ring \| pin \| arrow, box: [x, y, w, h] in 0–1 }`. A pure `tourFor(part, platform)`. Additive. | unit tests on real data: every step has narration, every box is inside 0–1 |
| 13 | desktop (script) | `scripts/guide/voiceover.mjs`: reads every narration, calls `POST /v1/audio/speech` on this Mac's Off Grid AI Desktop, encodes AAC with ffmpeg, writes WebVTT captions and `voiceover.lock.json` (text hash → file) into both apps' guide assets. For clips, it muxes the voice-over into the mp4 as its sound track. Run by hand on this Mac, never in CI. | a test fails when a narration hash has no matching audio |
| 14 | desktop | `GuideTour`: step list, still, emerald marks drawn over it, caption, play / back / next, dots, ← / →, captions, mute, Reduce Motion. Pattern from `tasks/ComputerUseStepDetails.tsx` (step rows) and `media/ImageLightbox.tsx` (full view). | component tests: step change, auto-advance with audio end, keys, Reduce Motion, both themes |
| 15 | desktop | Clips play in the app's player (see C8) with chapters from the tour's steps and the VTT captions, in place of the muted loop. | player tests: controls, captions, chapters |
| 16 | mobile | `GuideTour` for React Native (44 pt targets, swipe between steps). A clip opens `GalleryVideoScreen`'s player as its own route with captions. | screen tests on real tour data; iPhone + Android run |
| 17 | both | Ask box: grows with the text and has a mic. Desktop: a textarea that grows to about 8 lines, Enter sends, Shift+Enter new line, the mic from `useChatVoiceTurns`. Mobile: `multiline`, max height 150 like `ChatInput`, `VoiceRecordButton` + `ensureWhisperForTranscription`; no speech model → the mic shows one line, never a silent tap. | tests: grow, keys, paste of long text, mic → transcript → send, no-model state |
| 18 | devices | Hand-test the tour, the player and the Ask box on Mac, iPhone and Android. Record a clip of each (things that move get clips). | new hand-test rows for the guide |

### Knowledge base: complicated flows (added 2026-11-18, standing work)

**Why.** The guide answers "how do I…" from `shared/packages/models/src/guide-kb/*.json` (657 flows: desktop 312, mobile 232, extension 83, cross 30). `build-guide-kb.mts` ships a flow only when each step label exists in the app's code, and `guide-howto-eval.test.mjs` checks held-out questions. The gaps are flows nobody wrote down. Example: "use my computer's models when not on the same Wi-Fi". The app supports it (Remote servers → Add manually → `http://<Tailscale IP>:7878`; the gateway listens on every interface). The KB has only the same-Wi-Fi scan, so the question matched Sync, a different feature.

**Goal.** The guide is the product's copilot. It knows every flow in every app, the flows nested inside each one, and what to do when a flow's condition is not met.

**Why flows get skipped (measured 18 Nov).**
1. **Nothing lists every control.** The KB was written screen by screen, along the main path. 183 of 338 labelled controls on mobile and 473 of 713 on desktop appear in no flow. "Add manually" was one of them.
2. **Conditions are prose.** 28 flows state a condition in `note` ("over the same Wi-Fi", "must be paired", "needs an image model"), and nothing requires a flow for when it fails.
3. **Nested flows are not linked.** A step that is a flow of its own (Add manually → API key → pick the model) has no link, so the guide cannot offer the branch or the next step.
4. **The tests share the blind spot.** The blind questions were written from the same screens, so no question asked "what if not".

**The fix for the class:**
- **A. Control inventory, as a ratchet.** The build reads every labelled control in each app's code and writes `guide-kb/coverage.json`. Each control is covered by flow ids, or ignored with a reason (Close, Back). A new control that is neither covered nor ignored fails the build, and the list of uncovered controls can only get shorter.
- **B. The flow graph.** Flows get `requires: [{ when, otherwise }]` and `next: [ids]`. The build fails on a condition in a note that has no `otherwise`, and on a link to an id that doesn't exist.
- **C. "What if" questions from the graph.** For each `requires`, the eval asks "what if <when> isn't true" and expects its `otherwise` flow.
- **D. The copilot uses the graph.** An answer shows its branches ("Not on the same Wi-Fi? →") and 2–3 follow-up chips from `next`. A model answer gets the graph neighbours as facts and a chat-style suggestion.
- **E. The sweep.** Cover every uncovered control, app by app and area by area, until the ratchet reads zero.

**What counts as complicated:** a flow that crosses devices (phone ↔ computer, extension ↔ desktop), crosses networks (Tailscale, remote server, gateway key), needs an OS permission (mic, screen recording, accessibility, notifications), needs Pro, a key or pairing, needs a model the device lacks, takes more than 3 screens (integrations, MCP), or recovers from a failure (download failed, out of memory, model too big, Boost).

| # | Repo | Change | Check |
|---|---|---|---|
| 19 | shared | Add the Tailscale remote-server flow, and one line on the scan flow: "Not on the same Wi-Fi? Add it manually with its Tailscale address." | eval: "not on the same wifi" and "over Tailscale" questions reach it, and Sync does not win |
| 20 | shared | `build-guide-kb.mts --coverage`: list every screen, sheet and settings row in the three apps that no flow cites. This is the to-do list, ranked by the tests above. | the report runs in CI as a note, not a failure |
| 21 | shared | Sweep by concept from the change map, complicated flows first: each gets steps checked against code, a source line, 10+ phrasings including the "what if" ones, 2 held-out eval questions, and a test that its nearest neighbour does not win. | `check:guide-kb` and the eval test pass |
| 22 | both apps | Count the asks the guide could not match: surface + "no flow" only, never the question text. Opt-in analytics only. The top misses feed step 21. | an event from a test build in PostHog EU |
| 23 | desktop | In `scan.py`, `guide-kb` becomes a place for every concept, so any change to a flow shows up as "update the guide" in its plan. Each onboarding step that changes a flow updates its KB entry in the same commit. | `scan.py --plan <any concept>` lists the guide KB |

### Follow-up prompts (added 2026-11-18)

Desktop chat already suggests the next message: `desktop/src/shared/chat-next-action.ts` builds the prompt and cleans the reply; `main/chat-next-action.ts` runs it as a background job after each reply; Tab accepts it as a draft. Mobile chat has nothing like it, and neither has the guide.

| # | Repo | Change | Check |
|---|---|---|---|
| 24 | shared | KB flows get `next`: 2–3 flow ids a person usually wants after this one (Tailscale → "connect with an API key", "pick the computer's model in chat"). `build-guide-kb` fails on an unknown id. A pure `followUpsFor(flowId, surface)` drops ones the surface cannot do. | unit tests on real KB data; every `next` id exists |
| 25 | both apps | The guide shows the follow-ups as chips under each answer. A tap asks it. They work with no model, so they work during onboarding too. When the answer came from the model, not a flow, the chat suggestion below is used. | screen tests; tap → answer |
| 26 | shared | Move `chat-next-action.ts` (prompt + cleanup) to `@offgrid/models`. Desktop and the browser extension import it. No behaviour change. | the existing desktop tests pass unchanged |
| 27 | mobile | Chat suggests the next message as desktop does: after a reply, a low-priority job through the residency lock (never a second model load), shown as one chip above the composer. Tap fills the draft. Never blocks saving or showing the reply. Off when the model is busy or the reply failed. | tests: suggestion after reply, none on failure, no extra model load; iPhone + Android |

Sources for the sweep: the code (step 20), the hand-test rows, PostHog (step 22, plus the flows where people fail, such as downloads), Argus backlog items, and every question Mac asks that the guide misses. Each miss becomes a flow plus an eval question.

## How the build runs (2026-11-18)

1. **Space first.** Disk has 2 GB free. Measure, list each folder with its size and owner, and delete only what Mac approves. Never delete a checkout with uncommitted or unpushed work, the Argus worktree, or app data. Desktop 0.0.58 and mobile 0.0.125 must be out first.
2. **One branch.** `feature/onboarding-picks` from `origin/main` in shared, desktop, desktop/pro, mobile and mobile/pro. A checkout with someone else's uncommitted work is not switched until that work is committed or Mac says what to do with it.
3. **Before shots.** `/screen-review` of today's onboarding and guide on Mac, iPhone and Android. These are the "before" side of the review page.
4. **Review page at the start.** Publish the change review page (spec below) with calls C8–C10, so Mac decides on the page, not in chat.
5. **Steps 0–18 in order.** After each step: its tests, typecheck and lint in the background, a device check of anything visible, new shots on the page. A step stops after 2 failed tries and asks.
6. **PRs.** One per repo, the review page link in each body, pushed with hooks. No merge without Mac's word.
7. **Every word through `t()`.** Mac, 2026-11-18: new onboarding screens use `t()` from the start (app-languages plan, call 5). Every text, label and accessibility label on the new screens and in `@offgrid/features` copy goes through `t()`, so the app-languages work never has to touch them.

## Review page

Spec for `desktop/scripts/change-map/review.py`:

```json
{
  "title": "Onboarding: what you want → which ones → how it works",
  "features": ["text", "vision", "image", "video", "stt", "tts", "dictation", "writing", "notes", "documents", "vault", "memory", "meetings", "todos", "agents", "sync"],
  "concepts": ["onboarding", "guide", "models", "licensing", "analytics"],
  "reviews": [
    {"dir": "mobile/docs/review/onboarding", "surface": "mobile", "platform": "ios"},
    {"dir": "mobile/docs/review/onboarding", "surface": "mobile", "platform": "android"},
    {"dir": "desktop/docs/review/onboarding", "surface": "desktop", "platform": "mac"}
  ],
  "require": {"onboarding": ["mac", "iphone", "android"]}
}
```

Published from the session that does the work. The link goes in each PR body.

## Calls for Mac (decided 2026-11-17: recommended on all)

| # | Decision | Recommended | Other option | Risk if wrong |
|---|---|---|---|---|
| C1 | How `features.json` grows | Add `intent` and `parts` beside today's fields | A separate onboarding list | A second list drifts from Argus and the website |
| C2 | Desktop onboarding runs before the router is mounted. How do Back and Forward work? | Its own step history with Cmd+[ / Cmd+] inside the gate | Mount the router first and make each step a route | Mounting the router first changes startup order for every user |
| C3 | New saved state: the picks | `appStore` + migration on mobile; settings on desktop | Not saved (lost on restart) | Without it, resume and "What you use" cannot work |
| C4 | Mobile Ask box before any model exists | Shown, disabled, one line: "Ask works once a model is set up" | Hide it until setup | Hidden looks like a missing feature |
| C5 | Pro's `onboarding.additionalSlides` hook | Retire it after Pro features come from shared (step 8) | Keep both | Keeping both shows Sync twice |
| C6 | People who already finished onboarding | Never shown again; "What you use" in Settings | Show once after update | Shown again feels like a reset |
| C7 | Guide media for about 20 features that have none | Real screenshots from the screen-review shots of each feature | Text only at first | Text only weakens step 3, the step that sells |

### New calls (open, 2026-11-18)

| # | Decision | Recommended | Other option | Risk if wrong |
|---|---|---|---|---|
| C8 | Desktop has two video players: `ChatVideoPreview` in core (media-chrome: play, scrub, time, mute, picture in picture, full screen, speed) and `VideoPlayer` in Pro (Video Studio). The guide is core, so it cannot use the Pro one. | Move the fuller player down to core `components/media/`, and Video Studio, chat and the guide all use it | The guide uses `ChatVideoPreview` as it is | Two players drift. One gets captions and chapters, the other doesn't. |
| C9 | Where the voice-over audio lives | The script writes the same files into each app's guide assets; the narration text and its hash stay in shared | One copy inside the shared package | React Native's bundler and Vite load assets from a package differently. A shared copy is a build risk for little gain. |
| C10 | Voice and language | One English Kokoro voice, picked by Mac from 3 samples; English only for now | A voice per platform, or more languages now | Mixed voices sound like different products. Each language multiplies the audio. |
