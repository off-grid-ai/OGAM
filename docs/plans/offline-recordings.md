# Offline Recordings & Transcriptions

Status: Planning
Epic: Offline Recordings & Transcriptions (single epic, all stories inside)
Tier: Pro-gated

## What this is

A Pro surface in the mobile app to record audio on-device, transcribe it locally
with Whisper, and generate an LLM title, summary, and action items. Recording works
in the foreground and in the background (lock screen). Nothing leaves the phone.

This is mobile's native analog of the desktop meeting recorder. The desktop recorder
relies on macOS ScreenCaptureKit + system-audio loopback, which iOS and Android do not
expose. Mobile therefore captures microphone audio rather than call/system audio.

## Why this is mostly orchestration, not new capability

The core primitives already exist in the codebase:

- Recording: `src/services/audioRecorderService.ts` records 16 kHz mono WAV to disk
  (foreground today).
- Transcription: `src/services/whisperService.ts` `transcribeFile(path)` transcribes
  any audio file with progress callbacks.
- Summarization: `src/services/generationService.ts` runs the active LLM; reuse it with
  a summary prompt.
- Persistence/metadata: `chatStore` already models audio fields (audioPath,
  waveformData, audioDurationSeconds); Whisper model download/management is solved.

The genuinely new work: the Recordings product surface, the record -> transcribe ->
summarize orchestration and persistence, background capture (the heavy native piece),
Pro-gating, and storage management.

## Decisions locked

- Transcription trigger: automatic after recording stops, with a setting to disable
  (auto-with-toggle).
- Long audio: chunked transcription with a progress indicator (handles long meetings).
  Confirm whisper.rn practical segment limits during story 4.
- Summary depth: structured summary + extracted action items (title, TL;DR, bullets,
  action items).
- Background recording: in scope (iOS background-audio + AVAudioSession; Android
  foreground service + mic notification).

## Stories (single epic - no sprint assignment yet)

1. Recordings data layer
   `recordingStore` (Zustand) + SQLite table:
   `id, title, audioPath, durationSeconds, createdAt, transcript, summary,
   actionItems, status`. Foundation for all other stories.

2. Record screen (foreground)
   Start/stop, elapsed timer, live amplitude meter (react-native-audio-api),
   save WAV to `Documents/recordings/`.

3. Recordings list + playback
   New tab. List by date, play/pause/seek, delete a recording.

4. Transcription orchestration
   On stop (when auto enabled) -> `transcribeFile` with progress UI. Chunk long audio
   into sequential segments. Persist transcript. Handle model-not-loaded.

5. LLM summary + action items
   Transcript -> summary prompt -> structured title / TL;DR / bullets / action items.
   Re-run summary on demand. Reuses `generationService`.

6. Recording detail screen
   Tabbed Transcript / Summary view, copy, export as text.

7. Background recording (iOS + Android)
   iOS background-audio mode + AVAudioSession; Android foreground service with a
   persistent mic notification (FOREGROUND_SERVICE_MICROPHONE on Android 14+).
   Interruption handling (incoming call, Siri, app kill/restart).
   Heaviest, highest-risk story. Native work on both platforms.

8. Pro-gating
   Gate the whole surface behind the Pro license via `proLicenseService`; upsell entry
   point for non-Pro users. Land before story 7 so native work isn't redone.

9. Storage management
   Size display, bulk delete, quota warning. Mirrors desktop retention behavior.

10. Settings + auto-transcribe toggle
    Setting to enable/disable auto transcription; transcription language; clear-cache.

11. QA, edge cases, polish
    Interrupted-recording recovery, permissions flows, no-model prompt, brand-voice
    copy pass, design-token compliance, unit + integration tests per repo conventions
    (eslint + tsc + tests; Gemini/Codecov/Sonar gates green).

## Dependencies and sequencing notes

- Story 1 (data layer) blocks everything.
- Stories 2 -> 3 -> 4 -> 5 -> 6 form the core foreground happy path.
- Story 8 (Pro-gating) should land before story 7 (background recording) so the
  expensive native work is not restructured for gating later.
- Story 7 is ~the largest effort and carries App Store / Android-policy review risk.
  Even inside one epic, treat it as separable: stories 1-6 + 8-11 deliver a complete,
  shippable foreground feature without it.

## Out of scope (flag for stakeholders)

- System / call-audio capture (OS-restricted on iOS and Android).
- Speaker diarization (who-said-what).
- Cross-device sync of recordings (would route through Off Grid Sync later).

## Reuse map (build on, do not fork)

| Need | Existing |
|------|----------|
| Record WAV | `audioRecorderService.ts` |
| Transcribe file | `whisperService.transcribeFile()` |
| Summarize | `generationService.ts` |
| Audio metadata shape | `chatStore` audio fields |
| Whisper model mgmt | existing model manager + whisper store |
| Pro license check | `proLicenseService.ts` |
