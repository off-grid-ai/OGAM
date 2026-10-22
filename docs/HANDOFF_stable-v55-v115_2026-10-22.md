# Handoff: stable release v55 / v115 (2026-10-22, 19:30 IST)

Branch `release/stable-v55-v115`. Last stable: v0.0.111. Change list and coverage: [RELEASE_DELTA_v0.0.111_to_stable-v55-v115.md](RELEASE_DELTA_v0.0.111_to_stable-v55-v115.md). That file is the 15:15 working list. The results below replace its device columns.

## Verdict now

**NO-GO, pending one step.** Every blocker found today is fixed and passed on a phone. The iPhone final pass is clean. The Android final pass on the release tip was still running at handoff (see "What is left").

## Final pass on the tip (2026-10-22 23:00 – 10-23 00:10 IST)

The tip is now `450698803`. It adds "A gateway's grounders and deciders are never offered as text models", a 3-line change to the remote model list. The user confirmed it belongs in this release.

**iPhone on `f476663d0`:**
- PASS: JS loads from Metro; D8 with tools off; a normal reply; Stop; a reply after Stop.
- FAIL, known non-blocker: D8 with tools on. Same as on `0ec805123`.

**Android on `450698803`:**
- PASS: D8 with tools on and with tools off on 2B; Stop; a reply after Stop; background mid-reply.
- PASS: D2, for context; D7 dictation; download labels.
- PASS, branch fixes: maker filter (Liquid AI shows only LFM2.5-2.6B; 8B A1B is hidden by the RAM fit rule); "Check for new models" says "Up to date" in 3 s; cold New Chat opens a new empty chat.
- Not rerun: D1, because the phone was hot (thermal status 2) and nothing since the earlier PASS touches local inference. Default system prompt read-out.
- Android settings were reset to the defaults: KV q8_0, MTP off. Context is still 16K, which is not the 4096 default.

**Found tonight (none blocks; all except finding 3 behave the same in v0.0.111):**
1. **D6 "Free memory & Retry" → foreground kill by the low-memory killer.** The retry ejects every model, then prompt enhancement reloads the 2B text model before the image model loads. The phone had a 16K context and about 8 GB used by other apps. This belongs to the known retry-button follow-up. Not rerun at the 4096 context.
2. **KV restore gives no speed gain on Qwen 3.5 (hybrid model).** `loadSession` restores, but llama.rn logs "no usable state checkpoint (recurrent/hybrid/SWA model), doing full cache clear", and the whole chat is read again (TTFT 30–40 s). Context is kept. v0.0.111 had no restore at all.
3. **The chat store row is too big for Android.** `local-llm-chat-storage` is 8.35 MB (963 chats); Android reads at most 2 MB per row (`SQLiteBlobTooBigException`). The hydration gate then keeps writes blocked all session ("saved state still unreadable; writes stay blocked"). Chats came back through Sync. The write-blocking behaviour is new since v0.0.111; v0.0.111 started empty instead.
4. **Pro Sync can hold the JS thread for minutes.** With a desktop peer sharing Downloads and Screenshots, decryption in pure-JS tweetnacl, file staging, and the Home screen re-sorting 963 chats on each store update held JS at 93–100%. A cold start took about 6 minutes to reach Home, and taps did not respond. The user turned the sharing off; a cold start still took 358 s while transfers settled. ChatStream was already in v0.0.111. The fix is deferred by the user (estimate: about 1 week, plus 1–2 weeks for moving chat storage).

**Environment changes:**
- The Mac is now `192.168.1.34`. Launch the iPhone with `xcrun devicectl device process launch --device 4CF4A291-280A-598C-8AC5-851073C14B30 --terminate-existing ai.offgridmobile.dev -- -RCT_jsLocation 192.168.1.34:8081`. Note the `--`.
- `npm run e2e:wda` needs `WDA_UDID=00008150-000225103CD8C01C`.
- Another session committed to this branch during testing. Metro hot-reloaded the change onto the phones mid-check.

## Review fixes and smoke on the tip `8d8c4936d` (2026-10-23, 01:00–03:00 IST)

PR #732 review fixes, each with a test that fails on the old code:
- `llm.ts`: unload no longer hands out a released context during the memory-reclaim wait.
- `whisperService.ts`: a finishing dictation no longer clears the next one's state.
- `hydrationGatedStorage.ts`: a change made before an empty first-launch read is saved.
- `MeshResidencyService.kt`: a foreground start is never stopped before it promotes.
- `SyncClipboardModule.kt`: no clipboard listener survives invalidation.
- Onboarding pager and Debug Logs list: keep iOS's default of no clipping.
- `uat.sh` and Fastfile: an empty TestFlight group list is refused before any build.

Tests: full jest (816 suites, 8399 tests), Android unit (139), node scripts (11), all pass.

**Android smoke (new native build):** all PASS. Covered: Mesh service across 5 rapid background/foreground switches, a reply, Stop and a reply after it, background mid-reply, eject then reload, two dictations, vision on a photo, speak aloud and stop, Chats scroll and search, Debug Logs, Settings. One process all session, crash buffer empty.

**iPhone smoke:** PASS for cold start (16 s), a reply, Stop, background (labelled early stop, then a normal reply), eject then reload (reproduced with logs), model list, vision on 0.8B, speak aloud, image generation (about 46 s), Chats, Debug Logs, Settings. The 6 app files changed since GO touch none of the problems below:
- One unexplained exit at 02:38 near "Eject All Models", while WDA was attached. No crash or jetsam report. Not reproduced with logs running (dialog held 30 s, then Eject).
- Dictation with Large v3: each turn runs to the 30 s cap (end on silence never fires), the first slice drops the start of the sentence, and the model adds "Thank you." over silence. Also: Android's speak-aloud was picked up by the iPhone mic during the test (the "Diwali" text).

**New follow-ups:**
- After image generation, the memory gate refuses to reload the 2B model. Cancelling the dialog clears the text model ("Unknown"), and the sent message gets no reply and no error.
- iPhone: a reply cut by backgrounding saved only the word "assistant" (role token leaking).
- Sync re-checks a backlog of 356 shared files each time the app comes to the front, which freezes the UI for a while (deferred Sync work).

## Fixes made today (all on the branch, in order)

| Commit | What the user gets | Phone proof |
|---|---|---|
| `bcd2815f2` | Picking the model that is still loaded selects it again. A photo after 0.8B → 2B → 0.8B goes to 0.8B. | iPhone + Android D3 PASS |
| `fd73fdfbb` | A picked vision model offers Photo while a text-only model is still loaded. | iPhone + Android D3 PASS |
| `0d2f71945` | The Chats search field scrolls with the list. | iPhone PASS |
| `855f6de3b` | The "Insufficient Memory" sheet quotes the need with the 200 MB headroom, so it never says "needs 1818, 1898 available" while refusing. Copy only; the gate itself is unchanged (it is the same in v0.0.111). | Unit + rendered test |
| `53d98c247` | **Blocker.** A dictation that whisper ends at its 30 s cap hands the mic back. Before: the next tap did nothing, then the mic stuck on "Transcribing…" for minutes. Same in v0.0.111. | iPhone + Android PASS |
| `39803790f` | **Blocker.** Switching apps during a reply on iPhone no longer kills the model. Before: the reply was cut mid-word and saved as finished, and every later message in every chat said "No response" until Eject. Cause: iOS blocks Metal work in the background; the ggml-metal error is sticky. Now the reply shows "Reply stopped early. Retry to continue." and the next send reloads the model by itself. | iPhone PASS, with no false alarms on 5 normal replies; Android false-alarm check PASS |
| `451b889c6` | **Blocker.** NPU (Beta) no longer kills the app on Android. Cause: the Hexagon session does not open on this phone, so llama.rn treated `devices:['HTP0']` as "none given" and used OpenCL, and the Adreno driver killed the process. We now ask for `['HTP0','CPU']`. | Android: 3 replies, no crash, no OpenCL work. On this phone it runs on the CPU (13.5 tok/s). |
| `0ec805123` + `f476663d0` | Tool-guidance rewording, then reverted: it did not stop 0.8B refusing on either phone. Net zero change. | — |
| `7b1be38e5` … `43451ae48` | Device drivers (foreground guard), journey scripts, npm scripts, release delta doc. Test tooling only; no app code. | — |

## Device results at handoff

**iPhone (4CF4A291), final pass on `0ec805123`.** App code is identical to the tip apart from the reverted prompt string.
- PASS:
  - D1: Qwen 2B, 34/30/31 tok/s
  - D2: KV restore
  - D3: switch + photo
  - D4: download, cancel, restart, Chat now on Qwen 3.5 4B
  - D5
  - D6: image in 52 s
  - D7: real dictation
  - D8 with tools off
  - Stop mid-reply, eject mid-reply
  - voice ×2, mic 30 s cap
  - background mid-reply, Control Centre mid-reply
  - Chats scroll + search
  - thinking, vision, branch fixes
- FAIL, not a blocker: D8 with tools on. 0.8B and 2B deflect general questions ("I don't have access to a tool…"). Same in v0.0.111. A follow-up card has been proposed.
- SKIPPED: CoreML disk-full guard (needs a full disk), remote Stop-before-send (no server).
- Known, ships: download buttons nested in cards are not separately reachable with VoiceOver. Same as v0.0.111.

**Android (505b53a0, OnePlus, Adreno 735).**
- PASS:
  - thinking (checked by hand)
  - vision, vision after a switch, LiteRT
  - cold start, Chats to the end, eject mid-reply, Stop, background
  - voice (`53d98c247`)
  - D1 CPU 13.6/15.4/15.7 tok/s
  - D2, D3, D5
  - D4 cancel part
  - early-stop false-alarm check
  - NPU: no crash
- FAIL, not a blocker: 0.8B with tools on refuses general questions, as on the iPhone.
- D6: refused by the memory gate (image model 3.06 GB, budget 2.0–2.5 GB). This is the gate working. Use a smaller image model, or skip.
- **Still running at handoff:** on `f476663d0`, D8 on 2B, Stop / after-Stop / background on 2B, D1 + D2 again, D6 (smaller model or skip), D7, branch fixes, download labels, and a read-out of the default system prompt.

## What is left

1. Finish the Android pass on `f476663d0`. Rerun only what fails, then one full pass (the team's rule). Then mark GO or NO-GO.
2. Run the pre-push gates once, without `--no-verify`. Today's pushes skipped them on request. The tip has had jest + tsc + eslint per fix, but knip and depcruise have not run over the new `scripts/e2e/*`.
3. Release flow (memory: release-version-flow): `uat.sh` builds the one AAB/IPA; promote ships it as is.
4. Merge to `main` with a merge commit, never squash.

## Follow-ups (none blocks; most are the same in v0.0.111)

- **Highest:** 0.8B (the Fast pick) refuses general questions with tools on. Do not offer `search_knowledge_base` when there is nothing to search (card proposed in the session).
- NPU on phones where the Hexagon session does not open runs on the CPU with no message. The `451b889c6` check that should show "Running on CPU" did not fire on the device.
- MTP draft head can still load on default devices (including OpenCL) on HTP: `node_modules/llama.rn/cpp/rn-llama.cpp:578`.
- Background mid-reply on iPhone: the reply is still cut. It is now labelled and recoverable, but an optional clean stop on `background` is not done.
- A Stop pressed before the first token leaves the user message with no reply and no "stopped" note.
- The "No response" card blames the backend ("K-quant on NPU/GPU…") whatever the cause.
- Pro clipboard sync reads the pasteboard on every return to the foreground, so iOS shows a "pasted from Mac" banner (`ios/SyncClipboardModule.swift:36-58`). Read only on a user action.
- The image "Free memory & Retry" button cannot succeed when only our models are freed. Its copy says "Free up space", but the shortage is memory, not storage.
- Copy and UI:
  - raw LaTeX
  - whisper noise tags ("*Footsteps*") typed into the input
  - "_Model loaded_" underscores
  - chat header shows "Models", not the model name
  - eject sheet shows "Done" twice
  - size mismatches (1.8 vs 1.19 GB, 1.82 vs 2.2 GB)
  - Sync device counts disagree
  - no Stop while a model loads
  - Chat Settings sheet is see-through
  - "NPU Layers" help text says GPU
  - "Last Generation" tok/s includes TTFT
  - an old failed whisper file listed under "Text"
- The chat does not always scroll to a new photo answer.

## Environment notes for whoever resumes

- **Metro:** pid 14606 on `:8081`, serving this working tree. Any uncommitted `src/` edit hot-reloads onto both phones, which restarted checks twice today. Commit, or work in a worktree, before touching `src/` while phones are testing.
- **iPhone JS:**
  - It loads from Metro only through the launch argument `-RCT_jsLocation 192.168.1.41:8081`; nothing is persisted.
  - Without the argument it runs the embedded `fd73fdfbb` bundle.
  - Clipboard sync is ON.
  - The default system prompt is hand-set to "Help Alex prepare the Acme pilot…". That prompt caused the "Alex" refusals.
- **Android:**
  - It is a debug build on Metro.
  - Backend is restored to CPU.
  - Animation scales are back to 1. The old driver set them to 0; that is now removed.
  - The phone is on mobile data with no Wi-Fi.
- **Build:**
  - GitHub downloads hung during `npm ci` and gradle (`llama.rn` natives, `react-native-audio-api` ffmpeg). They were copied from `../mobile-crashes`, same versions, sha256-checked.
  - The Android build took 61 min while the Mac was swapping.
- **Testing method (user's standing rule):** Claude drives the phones itself: screenshot, judge, one action, look again. No scripted journeys for release checks. Rerun only the failed checks, then one full pass.
- **Incidents:**
  - Scripts sent "Say hi in three words." to Slack twice from the iPhone (about 15:26–15:28). The user has to delete these.
  - On Android, a tap opened Slack twice; nothing was typed.
  - During a phone call at 18:45 the Android agent sent one wake key and a keyguard dismiss.
