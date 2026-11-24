# Onboarding spec: what you want → which ones → how it works → models

Bar: `oga-cpto`, `oga-ux`, `off-grid-ai/brand/DESIGN_PHILOSOPHY.md` (Desktop and Mobile profiles).
Feature list: [feature-map.md](feature-map.md). Concepts: [v2/](v2/).

## Flow (both apps)

| Step | Route | Job |
|---|---|---|
| 1 What you want | `onboarding/groups` | Pick groups (X). Multi-select. |
| 2 Which ones | `onboarding/features` | Pick features (Y) inside the picked groups. |
| 3 How it works | `onboarding/guide` | The guide, filtered to the picks. Pictures, 3 steps, Ask box. |
| → Model setup | existing (`AutoSetup` on mobile, model gate on desktop) | Downloads only the model kinds the picks need. |
| → First result | Chat / Images / the first picked feature | Lands with a prompt filled in. No dead end. |

Every step is a route: Back and Forward return to the same step with the same picks (mobile: stack screens; desktop: Cmd+[ / Cmd+]). The last step reached and the picks persist, as `onboarding_step` does today.

## Nothing is lost (rule 0)

Everything the current onboarding does moves to a named place:

| Today | Where it goes |
|---|---|
| Desktop analytics opt-in switch + "What we share" | Step 3 footer, same switch and dialog. Mobile keeps its current place. |
| Desktop Pro pitch and price | Step 3: on each picked Pro feature, one line with price, Get Pro, and Enter license key. |
| Desktop Sync step: pair a licensed device or enter a key | Step 2: shown when a Pro feature is picked ("Have Pro? Enter key or pair a device"). Sync itself is a Y under Private and connected. |
| Desktop Connect step (QuickConnections) | Step 3: inline on the Integrations guide card. Still in Integrations later. |
| Desktop "You choose where each model runs" (Local default / Remote) | Model setup hand-off: one row, Local (default) or a server you add. |
| Mobile Boost slide | Step 3 when a picked feature is too heavy for this device (device-aware), and as a Y under Private and connected. |
| Mobile Pro Sync slide and voice tile | Sync and Voice mode as Ys. |
| Mobile "Get desktop" action | Desktop-only groups (Remember, Meetings) appear on mobile as one row "On your computer" that opens the desktop page. |
| Mobile Skip → AutoSetup | Skip on every step → model setup with today's defaults. |
| Desktop step resume after restart | Kept. |
| Dev "Reset onboarding" | Kept; also clears the picks. |

## Product bar checks

- **Smart defaults.** Chat is pre-picked. Features this device cannot run locally stay pickable with one line that says how it runs instead ("Runs on your computer", "Needs about 11 GB; uses Boost or your computer"). Model choice comes from the device, never asked.
- **Pro for a free user.** Pro features are pickable. Step 3 explains them and offers Get Pro or Enter key; model setup skips Pro-only models until Pro is on. Never a silent lock.
- **Loops.** Step 3 ends in model setup; model setup ends in the first picked feature with a prompt filled in. Changing picks later: Settings → "What you use", which re-sorts Home.
- **Pressed → working → done.** Tiles and rows toggle within one frame. "Set up my models" shows working on the button until the hand-off lands.
- **Less is more.** One line per tile and row. No paragraphs. Desktop uses the grid and columns; mobile is one vertical flow, 44 px targets.
- **Design doc.** Geist and Geist Mono only. Emerald only for selection and the one primary action. PRO is a muted mono tag. Glass surfaces, hairlines, living background. Motion: transform and opacity only, reduced motion honoured.
- **Every platform.** Android and iOS: 5 groups (no Remember, Meetings). macOS, Windows, Linux: 7 groups; Scribe overlay has no Wayland support and some tools are macOS-only, so those rows show the platform line from `platforms`. Browser extension: not in onboarding; shown as "Also in your browser" on Scribe and Vault.

## Guide media and Ask (added 2026-11-18)

Step 3 is the guide. It works with no model downloaded, because the media is prerecorded. Concepts: [v3/](v3/).

**Today.** Each topic has one still (dark and light) or a muted, looping clip with no controls (desktop `<video autoPlay muted loop>`, mobile `Video repeat muted`). The Ask box is a single line on both apps (desktop `<input>`, mobile `TextInput` with return to send) and has no mic.

| Part | What it becomes |
|---|---|
| Stills → **tour** | Each topic is a short list of steps. A step is a still (dark and light), draw-over marks, one caption line and a voice-over clip. It works like the Computer Use step view: a step list ("Step 1 \| Type what you want to see"), and the screenshot of the active step. Controls: play (voice plays and the tour moves on by itself), back, next, step dots, ← / → keys, captions (on by default), mute. With Reduce Motion on, nothing moves by itself. |
| Draw-over | Data, not pixels: each mark is `ring`, `pin` or `arrow` with a box in 0–1 units over the still. The app draws it in emerald, so it stays sharp in both themes and at every size, and one still serves many steps. |
| Clips → **player** | The app's own video player with all its controls: play, scrub with chapter ticks, time, speed, captions, volume, picture in picture, full screen. Voice-over is the clip's sound track. On mobile, tapping the clip opens the full player as its own route. A player is never in a modal. |
| Voice-over | Made on this Mac by Off Grid AI Desktop: `POST /v1/audio/speech` (Kokoro) on the local server, one fixed voice. A script reads each step's narration from shared, writes AAC audio and a WebVTT caption file, and stores the hash of the text. A test fails when the narration changes and the audio does not, so the audio and the words never drift apart. |
| Ask box | Grows with the text, like Chat: from 1 to about 8 lines on desktop and to 150 pt on mobile, then it scrolls. Desktop: Enter sends and Shift+Enter starts a new line. Mobile: return starts a new line and the send button sends. Pasting a long text keeps the caret in view. |
| Ask mic | The same transcription as Chat: desktop `useChatVoiceTurns`, mobile `VoiceRecordButton` with the Whisper check. While you speak, the live transcript goes into the box, then you send it. With no speech model yet (onboarding on mobile), the mic shows one line: "Talk to ask works once a voice model is set up". |

## Single source (shared owns business logic)

`@offgrid/features` (`shared/packages/features/src/features.json`) becomes the one list for groups, features, Free/Pro, platforms, model kinds and guide copy. Mobile and desktop only draw it. It needs: a `group` that matches the 7 groups, the missing features (feature-map.md), per-platform availability, and guide content (tagline, 3 steps, media). The desktop guide (`guideKnowledge.ts`, `proCatalog.ts`) reads from it; mobile gets the guide page.

## Analytics (opt-in only)

`onboarding_picks` once: groups, features, skipped step. Existing `flow_step` steps stay; add `groups_shown`, `features_shown`, `guide_shown`.

## Open

- Web Use / Computer Use is Free for now. The shared list marks it Free; `proCatalog` (Tasks) and the desktop guide's extension copy still say Pro.
- Mobile image and download failures report only "error" and count some stops as failures. Fix before reading onboarding results.
