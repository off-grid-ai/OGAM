# PR #558 — on-device verification checklist

The jest tests prove the JS decisions over faked device boundaries. THESE are the native/real-hardware
outcomes only a physical device confirms. Run on both a 12GB Android (Mac's real target) and an iPhone
where noted. Mark P/F.

## HIGH priority — the risky memory changes (verify FIRST)

1. **[Android 12GB] Reclaim gate — big model loads instead of false-refusing.**
   Aggressive mode. Have a couple of background apps open (real memory pressure). Load a ~5GB text
   model (e.g. qwythos-class). EXPECT: it loads and generates — NOT "it needs ~X but only Y available".
   This is the reclaim-aware fix; the risk it must NOT do: jetsam/OOM-kill the app on load. If it crashes
   → the reclaim credit is too generous on your device. FAIL = crash or false-refuse.

2. **[Android 12GB + iPhone] Load Anyway appears on a genuine refusal, any mode.**
   Force a refusal (Balanced or a model bigger than even the reclaim budget). EXPECT: an "Insufficient
   Memory" alert WITH a "Load Anyway" button — never an OK-only dead-end. Tap Load Anyway → it attempts
   the load. (On a truly-too-big model it may still OOM — that's the accepted risk of the override.)

3. **[iPhone] SDXL (Core ML) image download → finalize + first generate.**
   Download SDXL. EXPECT: completes, unzips, registers (NO "…couldn't be opened, no such file"). Then
   generate one image. The first ANE compile (~120s) is the OOM-risk moment — confirm it doesn't hard-crash.
   If it crashes on first compile → SDXL is too heavy for the device (a real limit, not our bug).

## HIGH — the voice/mic gesture fixes (newest; device-only, no jest layout)

V1. **[both] "Slide to cancel" pill forms properly.** Empty composer (the send slot IS the mic).
    Press and HOLD the mic. EXPECT: a "Slide to cancel" pill appears to the LEFT of the mic with the
    full text on ONE line — not clipped, not wrapped into a smear, not overlapping the mic. (This is the
    cut-off bug; jest can prove width+single-line but not the pixels — your eyes are the only proof.)

V2. **[both] Slide-to-cancel actually cancels vs sends.** Hold to record and speak. (a) Slide LEFT
    past ~1cm and release → EXPECT: recording discarded, NOTHING lands in the composer. (b) Hold, speak,
    release WITHOUT sliding → EXPECT: it transcribes into the composer.

V3. **[both] Cold-load gesture continuity + NO ghost recording.** Trigger a cold whisper load first:
    fresh launch, or load a big text model so whisper was evicted. Now press-and-HOLD the mic. EXPECT:
    the button shows a spinner but STAYS a button you can slide/release (not a dead spinner). Now RELEASE
    while it is still spinning up (before recording starts). EXPECT: it cancels cleanly — mic returns to
    idle, no transcript, and NOTHING keeps recording in the background. Press again → records normally.
    FAIL = mic stuck recording/spinning forever, or a session you can never stop (the ghost).

## MEDIUM — the recovery/parity fixes

4. **[both] Image download interrupted → Retry recovers.** Start a large image download, kill WiFi mid-way
   so it fails, restore WiFi, tap Retry. EXPECT: it re-downloads and finalizes (not a stuck failed card).

5. **[both] Voice dictation under memory pressure.** Load a text model, then hold-to-talk dictate.
   EXPECT: transcribes (frees the model + loads whisper if needed) — never a silent empty composer.

6. **[both] TTS speak under memory pressure.** In audio mode with a text model resident, have the
   assistant speak a reply. If TTS can't fit, EXPECT: a visible failure card with Load Anyway — not the
   speaker icon silently stopping.

7. **[Android] Onboarding — over-budget curated LiteRT model (E4B) is offered with a warning.**
   On the onboarding model-download screen, EXPECT: the over-budget E4B card is PRESENT and shows a
   "may exceed your device's memory / Download anyway" warning — not hidden/undownloadable.

## LOW — behavior polish

8. **[both] Tool-using model:** reply shows clean text, no `<function=…>` markup leaking.
9. **[both] Remote model that reasons inline (LM Studio/Ollama, gemma-style):** the Thinking toggle appears.
10. **[both] Resend a message with no image model loaded:** it regenerates as text (same as send) — not a crash/"no image model".
11. **[both] Force image mode, queue a send behind a running generation:** the queued one still draws an image (doesn't fall back to text).

## Regression sanity (the "did we break Android" gate)
12. **[Android]** General chat, image gen, voice — all still work as before. The whole batch's shared JS
    changes were bundle-verified for Android; this is the human confirmation.

## Known device-limit (not a bug to fix)
- If SDXL (or any multi-GB Core ML/dirty model) jetsams on the first ANE compile, that is a genuine
  device memory ceiling — the app's gate/Load-Anyway behaved correctly by warning first.

## iOS build-config (verify on the next Debug install)
13. **[iPhone] Debug build home-screen name = "Off Grid AI Debug".** After installing the .dev (Debug)
    build, the app icon label must read "Off Grid AI Debug" (distinct from the release "Off Grid AI").
    NOTE: this is a build-time plist-variable expansion — config is set correctly but only a real Debug
    build confirms the name renders. If it shows literally "$(INFOPLIST_KEY_CFBundleDisplayName)" or blank,
    the var didn't expand → flag it.
