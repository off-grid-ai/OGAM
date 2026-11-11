# Atlas future features - user's official idea list

Updated: 2026-10-15
Source of truth: this is the user's own initial list of ideas for future Atlas updates, not a list of completed features or a release commitment.
Repository: https://github.com/coolchan03/Atlas

## User-requested ideas

- [ ] **FF-01 - Email and replies from notifications**
  - Original: "Email, respond to messages/texts in notifications?"
  - Explore email support and replying to incoming messages/texts from Android notifications where the OS and source app permit it.
  - To decide later: providers, permissions, drafting versus sending, and whether replies require confirmation.

- [ ] **FF-02 - Actual phone call screen**
  - Original: "Actual phone call screen"
  - To decide later: phone-call-like full-screen AI voice UI, or integration with actual cellular calls; do not silently assume either interpretation.
  - **Decided by the user (2026-10-19):** make voice mode look like a regular phone call (in-app UI, not cellular calls). Implemented in 0.0.105 (`src/atlasVoice/AudioInput.tsx`): full-screen call screen with caller name, call timer, Mute / Speaker / Hands-free, End call, talk-over interruption and a phone-conversation reply style. Not checked off until verified on the Razr and onn tablet.

- [ ] **FF-03 - Automatic cloud backup**
  - Original: "Auto cloud backup"
  - Plan opt-in scheduled backups, an approved destination, encryption, version history and a verified restore path.
  - This is distinct from automatic cross-device sync, which was previously *not* requested.

- [ ] **FF-04 - Gemini, Claude, and ChatGPT backup**
  - Original: "Gemini, Claude, and chatgpt backup"
  - To decide later: importing/exporting histories from these services into Atlas, backing them up independently, or both.
  - Do not claim direct account access or a supported import mechanism before checking providers and available export formats.

- [ ] **FF-05 - Slow-model warning in hands-free mode**
  - Original: "Warning for slow models with handsfree mode"
  - Before hands-free chat, warn when the selected model may have high latency; show measured speed where available and let the user choose how to proceed.

- [ ] **FF-06 - Automatic/scheduled messages and reply notifications**
  - Original: "Auto messages/schedule messages and notifications of responses"
  - Explore drafting or scheduling outgoing messages, and notifying the user when responses arrive.
  - To decide later: which services, approval policy and whether autonomous sending is desired.

- [ ] **FF-07 - Other apps acting on their own; recording/transcripts**
  - Original: "Ability to use other things on their own (recording app auto transactions and save audio and label speakers)"
  - Explore user-approved workflows with other apps; example: a recorder that saves audio and identifies/labels speakers.
  - **Wording to confirm:** original says "auto transactions"; it might mean "automatic transcriptions." Keep this uncertainty until clarified.
  - Define microphone permissions, recording consent, storage and whether processing must remain on-device before implementation.
  - **0.0.105 (user-requested):** first version built: opt-in Recorder with a visible indicator, on-device
    transcript with speaker labels, kept only on the phone and not in backups. Unchecked until tested on a device.

- [ ] **FF-08 - Live camera**
  - Original: "Live camera?"
  - Possible future live camera/vision interaction. Scope and device performance requirements are undecided; do not mark as an existing feature.

- [ ] **FF-09 - Tiered emergency/offline knowledge backup**
  - Original: "What if we had levels to the emergency backup thing like small backup, medium, and large, where like large has all of wikipedia on it?"
  - **Small (Essential):** Offline first aid, immediate emergency procedures, practical survival and navigation information; prioritize minimal storage and availability without network access.
  - **Medium (Extended):** Everything in Small plus expanded medical/survival/repair references, regional maps and a curated or compact offline encyclopedia.
  - **Large (Comprehensive):** Everything in Medium plus the complete offline English Wikipedia, including images when the user selects the full Kiwix ZIM archive; other languages and additional collections may be separate options.
  - This refers to DOWNLOADABLE OFFLINE EMERGENCY LIBRARY TIERS, not FF-03 automatic cloud backup and not emergency backup of user chat data. Confirm naming in product UI when scoped.
  - Reuse and validate existing Atlas library/Kiwix ZIM support. Offer storage requirements before downloads, Wi-Fi-only option, resume/checksum verification, optional external storage, progress/cancel, delete/upgrade packs, and avoid downloading duplicate data. Include an offline search/browse test and a local AI knowledge retrieval test.
  - Storage reference only, not fixed tier sizes: Kiwix mirror listed August 2026 English Wikipedia maxi (with images) at about 118.7 GiB, September 2026 all-mini at 13.4 GiB and March 2026 no-images at 48.4 GiB. Re-check catalog size, free space and support before presenting in-app choices. A complete Wikipedia snapshot is not live-updated.

## Future additions

Add new ideas below only when the user proposes or explicitly approves them. Do not populate this section with assistant-generated suggestions.

- (No additional user-approved features yet.)

## Instructions for the next Atlas update

1. Read this official feature list first. Ask which item IDs the user wants to develop only if they have not already specified them.
2. Compare selected ideas to the current implementation before writing code; some functionality may already exist partially. Never count a feature complete solely because source code or a setting exists.
3. Resolve ambiguous details with the user before implementation. Nothing in this file authorizes sending emails/messages, recording, reading notifications, or accessing cloud accounts without consent.
4. Implement the chosen items, add tests, produce and validate a correctly signed APK, and verify relevant phone/tablet behavior before checking them off.
5. Record completed item ID, version, commit and verification evidence here; preserve unselected ideas for later.
6. All GitHub writes must be made using the user's Tunnel to Surface connection.

**Separate records:** Engineering bugs and earlier assistant-generated suggestions are *not* part of this user-authorized future-feature list. Consult docs/GAPS_BACKLOG.md, docs/PENDING_FIXES.md and release audit documents only as technical references.
