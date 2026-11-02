# Atlas 0.0.105 — Changelog and Handoff

Status: **published** as [Atlas build 75](https://github.com/coolchan03/Atlas/releases/tag/atlas-75)
(signed APK, commit `fbe7be78`; build 72 is an earlier publish of the same version). Built on `atlas-voice` @ `d334d31` (v0.0.104) on branch
`claude/atlas-implementation-handoff-kvnfzs`. Android `versionName` 0.0.105, `versionCode` 1784144539.

Nothing here has been run on a physical phone or tablet. Every item marked *needs device test* must be
checked on the onn Pro 13 and the Razr Ultra 2025 before it is called done.

---

## 1. Vulkan and hardware acceleration

### Implemented
- **The llama.kt Vulkan text engine is now built into the release APK.** Root cause of "Vulkan not available":
  the official build never passed `-PatlasVulkanEnabled=true`, so `:atlasLlamaKt` was never compiled into
  releases (only into a side-by-side `.vulkantest` experimental app). The official workflow now builds it and
  **fails the release** if `lib/arm64-v8a/libllamakt.so` is missing. A release-contract check prevents the
  flag being dropped again.
- The side-by-side `.vulkantest` package id is gone; the release updates the normal Atlas install.
- App minimum Android version stays **7.0 (API 24)**. llama.kt needs Android 10 (API 29): the manifest overrides
  the library minimum and the bridge refuses to load llama.kt below API 29, reporting "needs Android 10".
- **OpenCL stays separate.** llama.kt is built Vulkan + CPU only (OpenCL sources/flags removed by the pinned
  overlay); OpenCL remains in llama.rn.
- **Diagnostics distinguish missing engine from unsupported hardware.** New `runtimeStatus()` reports one of:
  `not_packaged` (build problem), `native_load_failed`, `sdk_unsupported`, `no_vulkan_device` (driver reports no
  Vulkan GPU), `probe_failed`, or `ok` with the detected devices. Support is decided by the driver's device
  list, never by chipset name.
- **Actual GPU layers are shown.** For Vulkan, OpenCL and NPU the app reports
  `min(requested, block_count + 1)` from the model's GGUF metadata — the layers llama.cpp actually assigns —
  as "N of M layers" in Model Test, runtime info and settings. Previously Vulkan showed 0 / "unverified" and
  OpenCL showed the requested 99.
- **Adjustable / maximum safe offload.** Vulkan now uses the same device-RAM cap as OpenCL. Settings has a
  **Maximum safe** button (offload every layer this device's RAM allows) next to the layer slider, and shows
  what the loaded model actually got.
- **No silent CPU.** Explicit Vulkan fails visibly if the engine is missing, no Vulkan GPU exists, the RAM cap
  leaves 0 layers, or the native load reports 0 GPU layers. Automatic mode may still fall through to CPU and
  says so.
- **Download reliability (PENDING_FIXES #2):** stranded downloads after an app update are marked
  "interrupted" with a retry instead of spinning forever (also covers retrying / waiting-for-network rows).

### Tested
- Unit/Jest: Vulkan adapter, LLM Vulkan load paths, offload accounting, Kotlin unit tests for the bridge's
  offload/GPU-detection helpers and the stranded-download rule (Kotlin tests compile/run in CI only).
- All `scripts/check-vulkan-*.cjs`, `check-llamakt-*` and `verify-llamakt-gradle` contracts pass; the
  Vulkan-only CMake overlay applies cleanly to the pinned llama.kt.
- GitHub Actions APK build: see "Build evidence" below.

### Needs physical-device testing
- onn Pro 13 (Mali / MediaTek): Settings → Text generation → Vulkan, load a Q4 GGUF, check Model Test shows
  "Vulkan … N of M layers" and real speed; try Maximum safe.
- Razr Ultra 2025 (Adreno): compare OpenCL vs Vulkan; confirm explicit Vulkan never runs on CPU.
- A device on Android 9 or older must still install and run (Vulkan reported as needing Android 10).

## 2. Tablet layout

### Implemented
- Layout follows the **window** width (Material size classes), so phones in portrait are unchanged.
- ≥600 dp (tablet portrait, unfolded foldable, landscape phone): **navigation rail** on the left, built from
  the same customizable nav-bar settings (order, hidden items and shortcuts behave identically).
- ≥840 dp (13.2" onn in landscape): **two-pane Workspace** (Projects | Agents side by side) and **Model
  Settings in two open columns**.
- Chat on wide screens: header aligned with the readable column; user bubbles narrower, answers wider.

### Tested
Jest render tests prove phone layouts are unchanged and tablet layouts switch at the breakpoints.

### Needs physical-device testing
Rotation on the onn tablet, the Razr's inner screen in both orientations, split-screen/multi-window.

## 3. KittenTTS voices

### Implemented
- **KittenTTS Nano (v0.2, ~29 MB)** and **Mini (v0.1, ~163 MB)** as optional downloads, each with 8 built-in
  voices, running on the existing sherpa-onnx engine with the same sentence streaming, stop/cancel, one-thread
  load/free (memory) and offline playback as Kokoro/Piper. Existing Android TTS, Kokoro and Piper unchanged.
- **Verified locally** with sherpa-onnx 1.13.7 (same version as the app): both packages load, 8 speakers,
  24 kHz, non-silent audio for every speaker (~1 s per sentence for Nano on 4 x86 cores).
- **Licensing checked:** both packages ship an Apache-2.0 LICENSE; the voices workflow refuses to republish a
  KittenTTS package without it. Their espeak-ng-data is GPL-3.0 data, redistributed the same way as the
  existing Piper/Kokoro packages.
- Voices are named "Kitten 1–8": upstream labels alternate male/female, but a pitch check did not confirm the
  order for the packaged models, so no gender is claimed. Each voice previews when chosen.
- **Named voice profiles** (voice + speaker + speed) with preview, stored on the device.
- **Per-agent voice:** Agents → edit → Voice. That agent's replies are read in its profile; the saved app voice
  is restored afterwards for other screens.

### Not implemented: voice cloning (KittenTTS 2)
Correction to an earlier draft: **KittenTTS 2** (KittenML, 1.7B parameters, 506 MiB–1 GB) does clone a voice
from 5–30 s of audio. The packages shipped here are the older lightweight KittenTTS models, which cannot.
KittenTTS 2 is not in this release because:
- its only non-Python runtime (`kitten-tts-2-cpp`, MIT) is a batch command-line tool with a LibTorch
  (TorchScript) waveform decoder and no documented Android/ARM64 build;
- its voice cloning needs an offline Python preparation step;
- its weights use the separate "Stellon Labs Community License", which could not be read from this build
  environment (Hugging Face blocked), so redistribution terms are unverified.
A practical route: prepare the voice on a computer with KittenTTS 2, import the prepared voice into Atlas,
and run a KittenTTS 2 engine ported to Android (llama.cpp fork + Android LibTorch decoder). That port is a
separate native project; voice sample recording/import was not built until it exists.

### Done
The **Build Atlas voices** workflow ran successfully on 2026-10-19, so `kitten-nano-en.zip` and
`kitten-mini-en.zip` are on the `atlas-voices` release.

### Kokoro v1.0 voices (chosen by ear from rendered samples)
- New downloadable voice **Kokoro v1.0** (`kokoro-v1-en`, sherpa-onnx `kokoro-int8-multi-lang-v1_0`,
  Apache-2.0, LICENSE checked by the voices workflow): 28 English speakers, US and UK.
- British speakers load the UK pronunciation dictionary only with `lang="en"`; American speakers load
  the US one with `en-us` (`NeuralTts.kokoroDictionary`). `lang="en-gb"` renders silence, so it is not used.
- **Voice depth:** a speaker can be played lower without changing its pace. Atlas generates the speech
  faster and plays it back slower by the same factor (`NeuralTts.deepen`). "Lewis (deep)" is Lewis at 0.9
  (about 81 Hz instead of 91 Hz).
- Models -> Voice -> Voice profiles offers ready-made profiles once the voice is downloaded:
  **Echo** and **Puck** (American), **Fable** (British) and **Deep British** (Lewis at 0.9).
- Rendered and listened to on a computer only. Phone speed on Kokoro v1.0 is not measured yet.

### Import your own voice
- Models -> Voice -> **Import voice file** adds a voice the user downloaded: a sherpa-onnx Piper (`vits-piper-...`),
  Kokoro or KittenTTS package as `.tar.bz2` or `.zip`. It is unpacked on the phone (paths outside the voice
  folder are refused), checked for a model and `tokens.txt`, named readably ("Northern English Male (Piper,
  en GB)") and used. Multi-speaker voices get a speaker stepper. Unconverted Piper files (`.onnx` + `.onnx.json`)
  get a message pointing to the sherpa-onnx version.
- Tested: Kotlin unit tests unpack real `.tar.bz2` and `.zip` archives and refuse path escapes; a rendered test
  imports a voice and steps through speakers.

## 4. Image and LLM reliability

### Implemented
- **Qwen repeated-text glitch — likely root cause fixed.** llama.rn re-parses all generated text into an
  accumulated `content` each token, and that parse can revise text already shown (Qwen's chat format holds
  back partial `<tool_call>`/`<think>` tags; failed partial parses arrive as raw tokens). The stream helper
  re-appended the **whole** reply whenever the new value did not extend the old one, and the stored message
  is built from the stream, so the repetition was saved. Deltas are now computed against displayed text and
  the final message is reconciled with llama.rn's parsed answer.
- Inaccurate acceleration reporting fixed (see §1).

### Not done (needs device or more time)
- Native image generation with `.gguf`/`.safetensors`, VAE/encoders, LoRA, `.pth` upscalers and JSON settings
  was **not executed** — it needs the phone/tablet. Tokenizer mismatches, model switching and memory errors
  were not re-investigated beyond the items above.

## 5. Project and chat protection

### Implemented
- **Plaintext leak fixed:** adding a document to a PIN-protected project left the *original file* unencrypted
  in the attachments folder. The copy is now deleted after encryption (and if encryption fails).
- Document paths/names are no longer written to the Android system log.
- **Protect existing projects with their chats:** protecting a project now encrypts each of its chats with the
  project PIN (verified) before locking. Unlocking the project opens its chats; new chats can be started inside
  an unlocked protected project and are sealed with the project PIN. Selective protection and permanent
  unprotect are unchanged.

- **Study outputs** of a protected project are encrypted in their own file (project PIN key); never written to
  plain storage, re-encrypted on every change while unlocked, dropped from memory on re-lock.
- An existing chat can be **moved into an unlocked protected project**; it is sealed with the project PIN.
- **Backup/restore audit:** restoring a backup used to delete every protected project on the phone (and
  locked chats missing from the backup). Restore now keeps them. Unlocked protected projects are included
  in password backups sealed with their own PIN and open on a new phone with that PIN.
- Nearby phone/tablet transfer was checked: protected projects, protected chats and study outputs are never
  sent.

### Not done
- Original document bytes are not kept for protected projects (only encrypted text/embeddings) — by design.
- Backup/restore and phone↔tablet transfer were not changed or re-audited beyond the above.

## 6a. Daily briefing (user report: ignored interests, made things up, read ads as news, odd page)
- Broad interests use Google News top-story sections (U.S., world, business, tech, science, health, sports,
  entertainment); others use a 2-day search. Press releases, sponsored/shopping items and stories older than
  48 hours are dropped; the same story from several outlets is merged; every interest gets a story first.
  Bing's outlet field (`<News:Source>`) was never read before; fixed.
- One part per real headline, written only from that story's own text, shorter when the source is thin. Fun
  facts come only from the offline library, never the model's memory.
- The page shows the exact headlines used (outlet, interest, time, link), uses the app's shared components,
  and shows step-by-step progress with elapsed time while it is made.
- Tested with fixtures in the real Google/Bing RSS formats; the live news hosts are blocked from the build
  environment, so a real-day check on the phone is still needed.

## 6. Project learning / Therapy

- The Therapy setup (six private chats sharing *Personal History*, *AI Instructions*, *Current Progress*) is now
  possible inside **one protected project**: create the project, add the three documents, create the chats,
  then protect it — or protect first and create chats while unlocked. No private data is in the repo or APK.
- **Shared files are now writable:** a chat can create or update a named project document (e.g. *Current
  Progress*) with the new `update_project_document` tool (enable it like other tools). In a protected project
  it is written straight into the encrypted vault. Save report to project works in protected projects too.
- **Tested:** an integration test has chat A append to *Current Progress* in a protected project and checks that
  chat B's prompt then contains that text, with only encrypted files written. The project prompt no longer
  tells the model to use tools that are switched off.
- Learning games: terms were already taken only from the project's passages; everyday filler words
  ("however", "important") are now kept out of crosswords, word searches and term games.
  The obsolete 23-games request was not implemented, as instructed.
- **Read and edit shared documents:** Knowledge base -> pencil writes a new shared document; tapping a note or a
  `.md`/`.txt` document opens it for editing (also from the project screen). Saving replaces the old version and a
  rename removes the old name. Documents keep their exact text (protected-project notes store it inside the
  encrypted vault) instead of being rebuilt from search chunks, which dropped spacing and repeated parts of long
  paragraphs. Tested with a rendered test on a protected project: only encrypted files are written.

## 6b. Recorder with speaker labels (FF-07, built at the user's request)

- Atlas hub -> **Recorder**. Opt-in: the user first confirms they will tell everyone they are recording. A red
  "Recording" indicator with a timer shows while it runs; leaving the screen asks to stop. Android's own
  microphone indicator also shows.
- After stopping, everything happens on the phone: Whisper writes timed text, sherpa-onnx speaker diarization
  finds who spoke when (pyannote segmentation 3.0, MIT; 3D-Speaker ERes2Net, Apache-2.0, about 45 MB, one-time
  download packaged by the voices workflow as `atlas-speakers.zip`), and the two are joined into lines per speaker.
- Users name speakers, tap a line to fix who said it, re-label with a known number of people, save the
  transcript to a project, and delete recordings. Recordings stay in Atlas's private storage and are not part
  of backups. A transcript interrupted by closing Atlas can be retried.
- **Accuracy (honest):** on a synthetic test conversation (three Kokoro voices) the labels were right for two
  clearly different voices, but two similar male voices were merged into one speaker unless the number of
  people was given. Real voices usually differ more; test on the phone with real people before relying on it.
- Tested: a rendered test records, transcribes and labels a two-person conversation, renames a speaker and
  fixes a line (microphone, files, Whisper and the speaker engine faked at the device boundary). Kotlin unit
  tests cover model lookup and resampling. Not run on a phone yet.
- **Share and download:** share a transcript to any app, download it as a text file, or download the audio
  (WAV) to keep a copy outside Atlas, since recordings are not in backups.
- **Upload audio or video files.** Recorder -> "Transcribe an audio or video file" opens the file picker for
  any audio or video Android can play (mp3, m4a, aac, ogg, opus, flac, wav, mp4, mov, webm and more). Atlas
  reads the first sound track on the phone (Android MediaExtractor + MediaCodec), streams it to a 16 kHz mono
  WAV without loading the whole file into memory, then makes the same labelled transcript as a recording. The
  title is the file name. Android only (the speaker engine is Android only); other phones do not show the
  button. Tested: a rendered test uploads a video and gets a two-speaker transcript (picker, files, decoder,
  Whisper and speaker engine faked at the device boundary); Kotlin tests cover the WAV header, stereo to
  mono, and resampling across chunk edges. Needs device test with a real phone video and a voice memo.

## 7. Voice mode ("phone call") speech input

- **Bug fixed:** voice mode treated a direct-audio chat model as "voice available", recorded each turn, then only
  transcribed it if a Whisper model was downloaded — so turns came back "couldn't hear that".
- Voice mode now uses a downloaded Whisper model as before, or **the phone's own speech recognizer** (on most
  phones Google's speech service, the one Gboard voice typing uses), asking for the on-device recognizer and
  offline recognition. If the offline language pack is missing it retries with the default recognizer (still
  asking for offline). The Android 11+ manifest query needed to find the recognizer was missing; added.
- Text-chat mic behavior is unchanged (the keyboard's mic already dictates there).
- **Looks like a phone call (FF-02, chosen by the user: in-app call screen, not cellular calls):** voice mode
  opens a full-screen call with the agent's name and initial, a call timer, status and live caption, round
  Mute / Speaker-Earpiece / Hands-free buttons, a talk button and a red End call. A hands-free call starts
  listening as soon as it opens.
- **Talk over it to interrupt:** in hands-free mode the mic is metered (not recorded or transcribed) while an
  answer plays. When you speak clearly over it for about 0.3 s, speech stops and a new turn starts. The
  recorder has no echo cancellation, so the trigger adapts to the answer's own echo level. It works best on the
  earpiece; on loudspeaker you may need to speak up.
- **Less talkative, more like a person:** call mode tells the model it is on a phone call: one to three
  sentences, answer first, offer details instead of listing them, contractions, short follow-up questions, no
  markdown or symbols, and do not repeat itself after an interruption.
- Needs device test: Razr + Gboard with the offline English pack installed, airplane mode, hands-free on;
  barge-in on earpiece and loudspeaker; that loudspeaker playback does not interrupt itself.
- The recorder that labels speakers (FF-07) was later built at the user's request: see 6b.

## 8. Learn a language (inside the "Learn a language" project)

- The Spanish Learning project is now **Learn a language**: pick the language, then play a board game of
  lessons. Six CEFR levels (A1 Beginner, A2 Elementary, B1 Intermediate, B2 Upper intermediate, C1 Advanced,
  C2 Proficient), 138 units of vocabulary, grammar and themes. A level saved by the earlier four-level course
  moves to the matching CEFR level. The AI writes each unit once, following a written teaching method
  (comprehensible input, recognition before production, spaced review), and keeps it for offline use.
- **Every square is one lesson of about five minutes.** Each game kind has a typical time (12 s to pick a
  word, 40 s to match pairs), and Atlas learns your own pace after a few answers, so quick games mean more
  exercises and slow ones fewer. Grammar, harder themes and big units are split into two lessons (part 2
  repeats two items from part 1).
- **Board:** a much bigger snake-shaped board with numbered squares and a pawn. Every two lessons you land on
  a story, a podcast, a one-minute speed round, a word search or a review square, and each level ends with a
  checkpoint (a ten-minute test of the whole level, 80% to pass). Levels are a 2 x 2 grid so names are no longer
  cut off; lesson text wraps instead of being cut.
- **Games:** pick the word, what does it mean, listen and pick, match pairs, true or false, letter scramble,
  fill in the blank, word order with extra words that do not belong, tap what you hear, type the
  translation, dictation (accents forgiven but pointed out), and the word search (English word bank, grid in
  the language you are learning, any alphabet).
- **Speaking:** "Say this out loud" exercises use the phone's own speech recognizer (offline when the
  language pack is installed). "Can't speak now" skips one; a microphone switch on the board turns them off.
- **Missed answers come back** once at the end of the lesson; only the first try counts for stars.
- **Daily goal:** a bar on the board shows today's XP against a goal (50, 100, 200 or 300; tap to change).
- **Progress is saved:** stars, XP, streak, finished squares, and a lesson left halfway carries on where it
  stopped. The course is included in Atlas backups.
- **Pre-made stories and podcasts:** a library of 110 pieces across A1 to C2: simplified fairy tales and
  fables, funny everyday moments, friends talking, places and culture, made-up news, news from history, and
  today's real headlines as a short bulletin. Thirteen are written out in full in Spanish and open instantly;
  the rest are written once by the AI at your level from an outline and kept.
- **Prepare this level:** one tap on the board writes every lesson and board story of the level with the AI
  on the phone, with progress and a Stop button, so the whole level then works offline without waiting.
- **Word book:** every word learned, with its meaning, a play button, how well it is known (five dots) and
  when it is next due; search in either language, sort A to Z or by what is due.
- **Weekly progress:** XP for each of the last seven days as bars, with this week's XP and lessons. Story and podcast squares land on their own piece. Create
  your own is still there.
- **Word search fix:** a word now counts wherever it is spelled in a line, also where the filler letters
  happen to spell it a second time.
- **Help while learning:** tap any word in a lesson or story for its meaning; a help button asks the AI tutor
  about the exercise on screen (it gives a hint before the answer); right and wrong sounds (on/off on the
  board); "Load the AI model now" when a lesson or story needs the model and it is not loaded.
- Tested: rendered tests play a lesson through, check levels and split lessons, resume a half-done lesson,
  solve a word search, open a pre-made story from a board square and move on, tap a word for its meaning,
  and turn sounds off. Needs device test: sound, pace and lesson length on the phone, and AI-written units
  and stories with the model you use.

## 8b. Language course additions (0.0.106)

- **Practice phone calls.** The AI plays a waiter, receptionist, taxi dispatcher and others and speaks only the
  language being learned, at the learner's level. Pick a situation (or describe your own) from "Practice call"
  on the course screen; a call square also sits on the board every 6 lessons with the situation of the lesson
  before it (done after the learner has said 3 lines). Each sentence is spoken as soon as it is written. "What do
  I say?" suggests a line with its English meaning. After hanging up the learner's lines are checked and real
  mistakes are shown with the corrected sentence. Uses the phone's speech recognizer in the learned language; a phone
  without one gets a typing box. Not checked on a device yet.
- **Tap a word.** Words are dotted-underlined. The bubble gives the meaning, a speaker button, a save-to-My-words
  button and, for verbs, a conjugation table (offline for Spanish by rule, written once by the AI for other languages).
- **Exams** every 8 lessons (70% to pass), a board-game look for the board, and "next lesson only" when preparing a level.

## 8c. Language course additions (0.0.107)

- **Crossword square** every 5 lessons: the clues are in English and the answers are written in the language
  being learned (tap a clue, type the answer, Check; Hint fills the first letter). It is optional: Skip marks
  the square done with no XP so the board moves on. Words come from the lessons so far.
- Conjugation tenses sit behind tabs (Present, Past, Imperfect, Future, Conditional).
- The "Your turn" card says how many lessons are left before the next exam.
- The course screen opens scrolled to the learner's square.

## 8d. Quality additions (0.0.108)

- **Learn a language is its own tab** (Learn, in the bottom-bar settings; also a Home card and a quick-home entry). It no longer
  shows in the Projects list. The built-in project record stays underneath, so earlier tutor chats, backups and sync are unchanged;
  the course screen has Chat with your tutor and Past chats.
- **Find the best settings** (model test page, GGUF models): loads the model with automatic acceleration and the CPU at a few thread
  counts, times a short reply each way, lists the speeds and keeps the fastest. After two slow replies (under 3 tok/s) a one-line tip
  above the message box suggests it. Optional **Warm up after loading** (Text generation, off by default) runs one silent reply after a
  GPU model loads. Not verified on a device yet; whether the tablet's first-question wait is shader compilation is still unknown.
- **My mistakes** (words missed most, a right answer takes one off), optional **Slower voice** for the course's spoken lines (off by
  default), and **Captions** on practice calls (off = listen first, tap a line to read it).
- **Save as file** in the chat menu (Markdown). **Backup reminder**: Settings shows when the last backup was; Home reminds after 7 days
  with no backup, then every 14 days, and can be snoozed a week. Atlas cannot back up by itself (the person chooses where the file goes).
- The course's model calls (lessons, word lookups, calls) now go through the background job queue, so they wait behind a chat answer or
  another job instead of failing with "Generation already in progress".

## 8e. Calls and the tablet GPU (0.0.109)

- **The tablet's GPU is the Mali-G57**, not the G615 (a wrong guess of mine): the "Automatic skips Vulkan" rule only matched the G615, so
  it never applied on the onn 13" Pro. It now matches the Mali-G57, the GPU that was measured (CPU 4.5 tok/s vs Vulkan 2.1).
- **Practice call listens with Whisper**, the same engine as transcription, told to expect the language being learned (multilingual models
  only; the ".en" models cannot). Falls back to the phone's recognizer, then to typing. Same end-of-turn rule as the main call, now one
  shared detector (`endOfSpeech.ts`).
- **Call mode**: the phone recognizer is asked to end the turn after about a second of quiet (its own default is longer), and the call
  screen shows where each turn's time went ("sent 0.8 s after you stopped, voice started 3.2 s later"; also logged as `[CALL-LAT]`).
  Not measured on a device yet, so whether this removes the walkie-talkie feel is unknown.

## 8f. Pairing, Learn tab and briefing (0.0.110)

- **QR pairing**: saving the other device failed with "Caller-provided IV not permitted": the pairing record is sealed with a key held in
  the Android Keystore, which creates its own random nonce and refuses one supplied by the caller. Sync and pairing encryption now go
  through `SyncCrypto` (the cipher picks the nonce and it is stored in front of the ciphertext), with JVM tests. Packets already on the
  wire keep the same format. Not verified on two devices yet.
- **Learn is a tab by default** (Home, Chats, Workspace, Learn, Settings). Someone who arranged their bottom bar before keeps it as it was
  and turns Learn on in Settings, Bottom bar.
- **Briefing**: "Topics to avoid" understood only the words in a headline, so avoiding "sports" removed almost nothing (a result about the
  Bears never says "sports"). Sports, Celebrity gossip, Politics and Crime now match what those stories are about, and the screen offers
  them as one-tap chips.

## 8g. Briefing and slow-reply tips (0.0.111)

- **Not for me** on every story of a finished briefing (the eye icon next to its headline): avoid a kind of story (Sports, Celebrity
  gossip, Politics, Crime; the kind it looks like is listed first), stop following the interest it came from, or just hide it from the
  list. The audio already made is not rewritten; the next briefing follows the choice.
- **The slow-reply tip says why** when the settings show it: the GPU is slower than the CPU on this device (Mali-G57: "Use the CPU"), or
  more threads are set than the phone has fast cores ("Use automatic threads"); otherwise it offers the settings test as before.

## 8h. Chat, projects, search and skills (0.0.112)

- **Save a chat as a file** from the chat menu: Markdown (.md) or plain text (.txt); "Share to an app" is last.
- **Chat layout** (Appearance): Clean by default (replies as plain text across the page, a bubble only for your own message, smaller gaps,
  wider column on a tablet); Bubbles keeps the earlier look.
- **Project types** (General, School, Work): starting instructions that never replace your own, and quick starts (Quiz me, Study plan,
  Summarize, Action items...) that open a new chat with the request typed in the box. Language learning is its own tab.
- **Home**: a Search row (chats and what was said in them, screens and settings by what people call them, projects, models) and a
  Continue card (your next Learn square, today's briefing).
- **Skills** (Settings, Skills): import a SKILL.md or a zipped skill folder, or paste one, in the open format Claude and OpenClaw use; see a
  preview first. A skill's instructions join the chat prompt when a message clearly fits its description or starts with /skill-name, cut to
  fit the model's context. Scripts and files next to SKILL.md are not run; programs a skill expects (curl, python) are listed. In backups.

## 8i. Share into Atlas and launcher shortcuts (0.0.113)

- **Share into Atlas**: text or a link shared from any app (Share, then Atlas), or text selected anywhere and sent with **Ask Atlas**,
  opens "What should Atlas do with this?": Ask about it, Summarize, Explain simply, Translate to English, Draft a reply. Each opens a
  new chat with the request already typed in the message box. Shared text waits if the app is still starting or locked behind a PIN.
- **Launcher shortcuts** (hold the Atlas icon): New chat, Practice call, Record, Today's briefing (links atlas://app/chat, call, record, brief).
- Native code only checked by the CI build and its JVM tests so far (ShareText); first use on a device will confirm both entry points.

## 8j. Undo, diagnostics, hold-a-tab, faster sync (0.0.114)

- **Undo delete chat**: deleting an ordinary chat is immediate; an "Chat deleted / UNDO" bar stays for 8 seconds. Images generated in the chat
  are deleted only when the bar goes away. Undo also clears the deletion record that sync would send, so the chat is not removed from the
  other phone. Locked and private chats still ask first and cannot be undone.
- **Copy diagnostics** (Settings, About): version, device, GPU, thread/GPU/context settings, measured speeds, last call timing. No chat text, keys or file paths.
- **Hold a tab** on the bottom bar: Home opens Search, Chats starts a new chat, Learn starts a practice call, Projects starts a project, Models opens downloads, Settings opens Appearance.
- **Sync pushes changes after ~5 seconds** (waiting for a streaming reply to finish) instead of only on the 60-second tick.
- Not changed: tools sent per message stay the user's choice (not pruned automatically); speed ideas that need a device measurement wait for Copy diagnostics numbers.

## 8k. Your list (0.0.115)

- **Briefing on Home**: the briefing row is always there ("Listen to today's briefing", or "Today's news briefing: not made yet, tap to make it").
- **Briefing summarizes**: each story is a two-to-four sentence summary in the AI's own words, with more and shorter stories; only 900 characters of an article are read for background, and the script is told never to read or quote it.
- **Calls end by themselves more reliably**: the quiet-after-speech rule now follows the room's noise (it no longer mistakes speech that starts at once for background noise, and handles a steady hum).
- **Learn practice call looks like a phone call**: no header, big caller circle, timer, round Captions / Talk / "What do I say?" buttons and a large red End call.
- **Lesson speaking exercise listens with Whisper** (the multilingual model, told the language) when one is downloaded, else the phone recognizer; tap the mic again to send.
- **Prepare lessons**: no longer fails because no model is "selected"; it uses the last used or first downloaded model, and a missing model gives a clear message.
- **Copy**: each table in a reply has "Copy table" (pastes as spreadsheet cells) and "Copy as Markdown"; code blocks have "Copy code".
- **Draft text or email**: new tool opens Messages or Email with the message written; you press send. Enable it per agent (Draft texts and emails).
- **Maps grounding**: "My location" now tells the model it only has coordinates and your saved places, so it should stop naming nearby airports or towns.
- **Sync**: a chat made on both phones (same title, one is the other plus more) is merged into one; an agent or project that is identical on both is not added twice. Two different chats with the same title are still both kept.
- **Learning mode without an agent**: choose "No agent" and the lessons are kept with the learning history.
- **Multicolor accent** (Appearance): each bottom tab has its own color.
- Not verified on a device: call end-of-turn, Whisper in lessons, the call screen look, Draft message links.

## 8l. Second round from your list (0.0.116)

- **Lessons**: every sitting goes through all six example sentences (the course now writes six, not five), and no sentence is shown twice in a row; single words are shared between the two sittings of a unit, sentences are not.
- **Home**: the Simple, Compact and Colorful homes replace "Presentations" with **Daily briefing** (the standard home already showed the briefing row). Five more themes (Mocha, Mint, Sakura, Graphite, Sunset) and six more accent colors (Orange, Lime, Cyan, Indigo, Fuchsia, Gold).
- **Learn a language listening**: Whisper is now found when any multilingual model is on the phone, even if an English one is selected; a lesson exercise frees the AI to make room for it; and if it cannot load, the screen says why (memory, error) instead of "no speech recognizer".
- **Voices**: lessons, the word book, word taps, stories and podcasts use the phone's different voices (a dialogue gives each speaker their own), and the practice-call caller keeps one voice per scenario. Phones with a single voice for a language sound as before.
- **Podcasts** play by themselves, part by part, with the text hidden until you tap "Show the text".
- **Briefing**: "avoid sports" now catches team names and scorelines (Chiefs beat Bills 27-20), and "sports news" or "all sports" count as sports; interests you avoid are skipped; no "welcome to the daily briefing" opener; silence at the start and end of each voice line is trimmed so there is no gap between lines.
- **Load the AI model now** button on the briefing screen and the Learn screen.
- Not verified on a device: Whisper in lessons and calls on the tablet, voice variety, podcast autoplay, line gaps.

## 8m. Calls, themes and small things (0.0.117)

- **Learn practice call**: loads the AI model before the caller speaks; with none downloaded it says so and offers "Load the AI model now". The transcript no longer pushes End call off the screen (the likely reason you got stuck), the phone's Back button hangs up, and the screen stays on during the call.
- **Colorful** now works in dark mode and with a chosen accent or background: pastel (dark: deep) tinted surfaces, each Home card in its own color, and each bottom tab in its own color.
- **Two more layouts**: Grid (big square tiles, two across) and Focus (only Chat, Learn and the briefing). Four more backgrounds: High contrast, Lavender, Peach, Navy.
- **Appearance**: "Surprise me" picks a random background and accent; "Reset the look" returns to the default (keeps your chat layout).
- Not verified on a device.

## 8n. Briefing: avoid topics, length, repeats (0.0.118)

- **Topics to avoid are checked by the AI**: after the word lists, the AI on the phone reads the candidate headlines (and your interests) and names the ones about a topic you avoid, even when no sports word appears. If it cannot be asked, the word lists still run.
- **Length is reached for real**: stories are written one by one until the script truly has the chosen number of spoken words; the last story written gets the goodbye, extra stories read in advance are left out, and the fun fact (if on) is still included. Before, the length was only estimated from the amount of source text.
- **No repeated cards**: two headlines about the same event (different outlets, different wording) or with the same link count as one, and each part is told which stories are already covered.
- Not verified on a device.

## 8o. Force load everywhere (0.0.119)

- The model picker (Home, Chats and the chat screen share it) has a **Force load: free memory first, skip the safeguards** switch. Switch it on and the next load unloads every other model and loads with the memory safeguards overridden, then the switch turns itself off.
- Any load that fails now offers **Free memory and load** (memory refusals) or **Free memory and retry** (any other failure), not only "Load Anyway" for some memory cases.
- The briefing, Learn and practice-call screens already had **Load the AI model now**.
- Not verified on a device.

## 8p. Importing a model that is already in the folder (0.0.120)

- Importing a .gguf whose name is already in the models folder no longer fails with "already exists" when the model is not in the list. A complete leftover copy is added to the list as it is (no second copy); a partial one is replaced. If the model really is in the list, it says so and names it.
- Not verified on a device.

## 8q. MTP files, more slides, skills and looks (0.0.121)

- **MTP files**: a model in My models has **Add MTP file** (and **Remove MTP file**). Import a model and its MTP .gguf together (pick both files) and the MTP file is attached; a lone MTP file explains how to add it. When the model loads, the engine drafts a few tokens ahead with the MTP file and the main model checks them. If the engine cannot start with the file, the model loads without it. Settings > Text generation > **Use MTP files** (on by default) switches it off. The runtime info says "MTP drafting on". Speed-up not measured on a device.
- **Slides**: seven more templates (Minimal green, Sage, Forest, Sunrise, Ocean, Berry, Mono) and five more slide types (Section, Two columns, Agenda, Quote, Big number). PDF export turns the new slide types into the basic ones with all the text kept. Bullets in PowerPoint files now show a bullet dot instead of a question mark.
- **Skills**: a library of 17 ready-made skills (summarize, explain simply, proofread, rewrite tone, email reply, meeting notes, text to table, study quiz, flashcards, math steps, decision helper, trip planner, recipe, daily planner, code explainer, careful fact-check, brainstorm), one tap each.
- **Looks**: four more backgrounds (Terminal, Midnight, Dune, Rosewater).
- Not verified on a device.

## 8r. MTP built into the model, and scheduled tasks (0.0.122)

- **MTP built into a model file**: importing a single file with MTP in its name now asks whether it is a complete model with MTP built in (it is then imported and drafts with its own MTP layers, no second file) or only the small MTP file (it explains how to attach it). My models shows **MTP built in: on/off** on every GGUF model without an attached file, to switch it by hand. "Use MTP files" in settings covers both kinds. Not measured on a device.
- **Scheduled tasks** (Settings > Scheduled tasks): have the AI do something at a time you set. Two kinds: **Ask the AI** (any prompt; start it with /skill-name to use a skill) and **Daily briefing**. Repeat once, every day, weekdays or weekly on a day, at an hour and minute. Four starting ideas (morning briefing, plan my day, weekly review, word of the day). Each answer is kept as a chat and a row on Home says it is ready. **Run now**, switch on/off, edit, delete. A failed run keeps its reason and is tried again after 15 minutes. Included in backups; not synced between phones (both phones would run it).
- **When tasks run**: while Atlas is open (when it comes to the front, then once a minute). Atlas has no background alarm yet, so a task due while the phone was away runs once when you come back, not once per missed time.
- Not verified on a device.

## 8s. Notifications for scheduled tasks, and Learn a topic (0.0.123)

- **Notifications from background alarms**: each switched-on scheduled task gets a notification at its time even when Atlas is closed (the next 10 runs of every task are set at once, so they keep coming for about two weeks; opening Atlas tops them up, and a reboot sets them again). Tap one and Atlas opens on Scheduled tasks, where the due task runs. Saving a task asks for the notification permission (Android 13 and up). Alarms are "allow while idle" ones: no special permission, but they can arrive a few minutes late while the phone dozes. The AI answer is still made when Atlas is open (tap the notification); it is not generated in the background.
- **Learn a topic** (Home > Learn a topic): the language board for any subject. Name it, say what you want to be able to do, where you are now, how you like to learn and how long a sitting is. The AI designs the board: how many squares (12 to 30, in units), and for each square a format of its own choosing to suit the subject: **lesson** (sections, an example, key points), **quiz** (multiple choice with reasons), **flashcards**, **match**, **put in order**, **practice** (an open task you answer in words or code, which the AI marks and shows a good answer for). It also names the board journey and says how it will teach. Each square is written when you reach it and kept, so it works again offline. Stars, progress, and a final quiz that covers the course. Courses are in backups, not synced. Hold a course to delete it.
- Not verified on a device.

## Build evidence and checks

- New **Android unit tests** workflow runs the Kotlin/JVM tests (`:app:testDebugUnitTest`) on every push that
  touches `android/`; first run passed.

See the end of this file (filled in after the final CI run).

## Not changed
- `FUTURE_RELEASES.md` keeps all nine items. FF-02 (call screen) was implemented at the user's request and is
  noted there, unchecked until device-verified. FF-07 (recording/speaker labelling) was built at the user's
  explicit request ("Do 2-6", then "build those"); it stays unchecked there until device-verified.
- The permanent signing key: the release workflow still requires and verifies the existing keystore; no new
  key was generated. No secrets, private chats or device data were committed.
