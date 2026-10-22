# Handoff: stable release v55 / v115 (2026-10-22, 19:30 IST)

Branch `release/stable-v55-v115`. Last stable: v0.0.111. Change list and coverage: [RELEASE_DELTA_v0.0.111_to_stable-v55-v115.md](RELEASE_DELTA_v0.0.111_to_stable-v55-v115.md). That file is the 15:15 working list. The results below replace its device columns.

## Verdict now

**NO-GO, pending one step.** Every blocker found today is fixed and passed on a phone. The iPhone final pass is clean. The Android final pass on the release tip was still running at handoff (see "What is left").

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
