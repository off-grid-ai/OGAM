# Browser extension: first run (plan only, nothing built)

2026-11-19. Chrome, Edge, Brave, Arc and Firefox. This plan uses the same three steps as desktop and mobile
(what you want, which ones, how it works). It adds the two steps only the extension needs: connect to your
computer, and allow what your picks need.

## Today (shots on the review page, Chrome)

- Nothing opens on install.
- The first open of the side panel is Settings: "Not paired" and "Pair with desktop". It never says what the
  extension does, what you can pick, or that it needs Off Grid AI on your computer with Pro.
- With no desktop app running: "Start Off Grid AI Desktop" and an address like 127.0.0.1:7878. There is no
  link to get the app.
- Site access is asked for in three separate places (`useSiteAccess`, `BrowserTasksRow`, `SettingsScreen`), at
  first use.

## Why the map missed it

The change map found a concept only from file names in code that already exists. The extension had no
onboarding files, so it got no step. Fixed in desktop 32cc2cf13: a concept now names every product it must
exist in, and an empty one is a MISSING step and a missing row on the review page.

## The flow

1. **Welcome tab on install** (`onboarding.html`, a full extension page). The side panel cannot open itself
   without a click, so the first run lives in a tab. It ends with one button that opens the side panel, and that
   click gives the browser the gesture it needs.
2. **What do you want to do?** The shared groups for `extension` (`onboardingGroups('extension')`): Chat and
   ask, Create, Write, Get work done, Private and connected. The pick rules come from `@offgrid/features`
   (`toggleGroupPick`, `cleanPicks`). The extension keeps no copy of them.
3. **Which ones?** The extension's parts: Chat, Ask about a photo, Images, Dictation, Fix and rewrite (Scribe),
   Passwords, Web Use, Web search and tools, Sync.
4. **Connect to your computer.** This reuses `PairingCard` and its states, with consumer words:
   - Found: "Off Grid AI is running on this computer." Pair with the six words.
   - Not found: "Get Off Grid AI for your computer" (download link), and "I have it, look again".
   - Found with no Pro: "Your picks need Off Grid AI Pro", with Get Pro, or "I have a key" (opens the desktop app).
   - After pairing: any picks made on the computer that also run in the browser are added, marked "From your
     computer".
5. **Allow what your picks need.** One list, one line per pick, each saying why (for example, "Fix and rewrite:
   read the text box you type in, on any site"). Only picks that need site access are listed. Each line can be
   skipped. The three ask points the app has now call this one owner.
6. **How it works.** For each pick: where it shows (side panel and shortcut, the Scribe chip under text boxes,
   the key in sign-in fields, the right-click menu), with "Try it on this page". The copy comes from a new
   `guide.extension` on each part in `features.json`. No part has one today.
7. **Done.** "Open the side panel" opens it on the first pick. Settings → What you use changes the picks later,
   as on desktop and mobile.

## Places (change map order)

1. shared `features.json` / `index.ts`: `guide.extension` copy per part. The extension tier, if call ext-tier
   says Pro.
2. browser-extension:
   - `src/onboarding/` (the page, reusing `PairingCard`);
   - `background/index.ts` (`onInstalled` opens it once, never on update);
   - `shared/prefs` (picks);
   - one site-access owner;
   - Settings → What you use.
3. desktop: a gateway call that returns this computer's picks, plus the analytics event `onboarding_picks` with
   `platform: extension`.
4. Tests: pick rules come from shared, so they are already covered. Add page tests for each connect state, a
   test that install opens the page once and update does not, and a test that the permission list follows the
   picks.
5. Hand test on Chrome and Firefox, then shots of every step on this page (step keys: welcome, groups, details,
   guide, setup).
