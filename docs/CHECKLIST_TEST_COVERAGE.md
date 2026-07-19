# P0/P1 integration coverage roadmap

This is the critical-behavior ledger for `docs/RELEASE_TEST_CHECKLIST.csv`. It replaces the former
ledger that counted deleted direct-screen, mocked-navigation, and store-manufactured tests as UI
coverage.

## Honest baseline

- Canonical critical rows: **126** — **27 P0** and **99 P1**.
- A checked row requires a real `App`/navigation journey driven by user gestures and visible
  assertions. Native/OS-only behavior additionally requires XCTest, JUnit, or the release-device gate.
- Current automated critical coverage: **47 complete rows** plus **8 partial device rows**. Test counts
  and line coverage are not substitutes for this journey ledger.
- Supporting pure-function or component contracts may remain useful, but they do not check a row here.

Legend: `[x]` real-App journey exists; `[~]` automated portion exists but a physical-device action is
still required; `[ ]` critical journey is open.

## P0 — release-blocking journeys (27)

### Install

- [~] #1 Fresh install launches — empty-storage App journey exists; physical install remains required.
- [x] #195 Boot is independent of download database recovery.

### Downloads

- [x] #4 Download a text (GGUF) model.
- [x] #9 Download an STT (Whisper) model.
- [x] #11 Download a TTS voice model.
- [~] #18 Interrupted download recovers after relaunch — Android/STT and iOS lost-row recovery render
  retriable cards after simulated relaunch; a physical force-kill remains required.

### Text generation

- [x] #23 First message lazily loads and replies with a GGUF model.
- [x] #42 Failed generation clears the spinner and renders an error.
- [x] #43 Stop mid-generation keeps partial output and restores input.

### Voice

- [~] #53 Chat-mode dictation reaches the composer with GGUF — the real ChatScreen hold gesture and
  transcript render are automated; physical microphone capture remains required.
- [~] #54 Chat-mode dictation reaches the composer with LiteRT — the direct-audio recording path renders
  its transcript in the real composer; physical microphone capture remains required.
- [~] #55 A chat voice note carries transcript, never raw model audio — the reviewed transcript sends as
  visible text from the real composer; physical microphone capture remains required.
- [~] #60 Full voice journey: STT -> model reply -> TTS — real-screen calculator and image voice journeys
  exercise routing, generation, tool results, and audio bubbles; audible device playback remains required.

### Image

- [x] #66 Image generation renders the generated image.

### Memory and residency

- [x] #85 Loading mode is selectable, shared by both surfaces, and persists.
- [x] #86 Downloading Whisper does not make it resident.
- [x] #87 Conservative mode keeps one heavy model resident.
- [x] #88 Balanced mode co-resides heavy models when they fit.
- [x] #93 Idle STT is reclaimed for a text turn.
- [x] #99 Oversized model shows a graceful memory card.
- [~] #101 Load Anyway follows the explicit override path — the real button bypasses a cautious refusal
  and renders the generated image when the post-eviction survival check is safe; physical-device native
  loading remains a device gate.

### Persistence and release

- [x] #167 Chat history survives relaunch.
- [x] #168 Downloaded models survive relaunch.
- [x] #171 Download entries survive relaunch.
- [ ] #180 Gemma-4 native-first thinking + tool journey.
- [x] #181 Upgrade-over-install keeps data and Aggressive loading mode on a physical Android 16 device.
- [ ] #187 Queued downloads survive app kill and resume.

## P1 — high-impact journeys (99)

### Install

- [x] #2 Complete all onboarding slides and reach Home.

### Downloads

- [x] #7 Download a vision model and its mmproj.
- [x] #8 Downloads badge count matches Download Manager.
- [x] #12 Download and extract an image model before it is usable.
- [ ] #13 Download a large text model.
- [x] #14 Download a LiteRT model.
- [ ] #15 Deleting one model does not cancel another download.
- [x] #16 Concurrent downloads queue and drain in order.
  - `__tests__/integration/downloads/queuedDownloadsKillDrainFullApp.rendered.happy.test.tsx`
- [x] #17 No-network download fails clearly and can retry.
  - `__tests__/integration/downloads/networkFailureRetry.rendered.redflow.test.tsx`
- [ ] #19 A truncated file is never listed as ready.
- [ ] #20 Kill during image extraction recovers safely.
- [ ] #21 Failed image extraction retries successfully.

### Text generation

- [ ] #24 First LiteRT message replies.
- [ ] #25 GPU/OpenCL backend generates and reports offload.
- [ ] #28 GPU-layer selection is honored.
- [ ] #29 LiteRT CPU incompatibility fails gracefully.
- [ ] #30 NPU/HTP is gated or returns a coherent answer.
- [ ] #31 Temperature applies to generation.
- [ ] #33 Context length applies.
- [ ] #34 System prompt applies.
- [ ] #38 Plain replies contain no reasoning markup.
- [ ] #39 Thinking renders in its block from the first streamed token.
- [ ] #44 Queue while generating preserves both turns in order.
- [ ] #46 Edit a user message and regenerate from it.
- [ ] #47 Regenerate an assistant reply.
- [ ] #48 Mid-conversation sampler changes apply to the next turn.

### Voice

- [x] #51 First-record microphone permission flow.
  - `__tests__/integration/audio/microphonePermissionFullApp.rendered.happy.test.tsx`
- [x] #52 Denied microphone permission is handled clearly.
  - `__tests__/integration/audio/microphonePermissionFullApp.rendered.happy.test.tsx`
- [x] #56 LiteRT tool turn receives voice transcript, not raw audio.
  - `__tests__/integration/audio/voiceModeCalculatorJourney.rendered.happy.test.tsx`
- [ ] #57 Leaving chat stops the microphone session.
- [ ] #59 Voice-mode transcript renders.
- [ ] #61 Voice draw request routes to image generation.
- [ ] #62 Voice calculator journey reaches tool result and TTS.
- [ ] #63 Voice-mode control becomes Stop during generation.

### Image and vision

- [ ] #67 Image size and guidance are honored.
- [ ] #69 Image steps are honored.
- [ ] #70 Generated image opens in the fullscreen viewer.
- [x] #72 A non-draw prompt routes to text with an image model active.
  - `__tests__/integration/generation/nonDrawRoutesToTextFullApp.rendered.happy.test.tsx`
- [ ] #73 Regenerating an image request draws again.
- [ ] #80 Vision model answers about an attached image.
- [x] #82 Large-model vision decode failure is user-visible and recoverable.
  - `__tests__/integration/generation/visionDecodeRecoveryFullApp.rendered.redflow.test.tsx`
- [ ] #83 LiteRT vision affordance matches capability.
- [ ] #84 Non-vision models refuse image input gracefully.

### Memory and residency

- [ ] #89 Text and Whisper co-reside on a roomy device.
- [ ] #90 Sidecars co-reside with a heavy model when they fit.
- [ ] #94 Idle STT is reclaimed in a voice turn.
- [ ] #95 Whisper can retry after memory is freed.
- [ ] #96 OS memory warning evicts idle sidecars.
- [x] #97 Aggressive mode loads larger models automatically.
  - `__tests__/integration/memory/aggressiveLargerModelFullApp.rendered.happy.test.tsx`
- [x] #100 Advisory and load-gate estimators agree.
  - `__tests__/integration/memory/imageToChatSwapFullApp.rendered.happy.test.tsx`
- [x] #102 Survival floor blocks a guaranteed OOM and does not offer a second override.
  - `__tests__/integration/memory/survivalFloorFullApp.rendered.happy.test.tsx`
- [x] #103 Image-to-chat transition swaps residency correctly.
  - `__tests__/integration/memory/imageToChatSwapFullApp.rendered.happy.test.tsx`
- [x] #104 Active model can switch mid-chat.
  - `__tests__/integration/generation/midChatModelSwitchFullApp.rendered.redflow.test.tsx`
- [ ] #105 Eject All frees every resident model.
- [ ] #106 Eject one model from the In Memory surface.
- [ ] #107 Ejected model lazy-reloads on use.
- [ ] #108 In Memory shows loaded RAM accurately.
- [x] #109 Deleting TTS clears stale memory pressure.
  - `__tests__/integration/memory/ttsDeleteClearsResidencyFullApp.rendered.happy.test.tsx`

### Knowledge base and projects

- [ ] #112 Create a project.
- [x] #113 Index a text PDF in the knowledge base.
  - `__tests__/integration/knowledge-base/projectKnowledgeBaseFullApp.rendered.happy.test.tsx`
- [x] #117 Embedding failure aborts indexing and Retry succeeds.
  - `__tests__/integration/knowledge-base/projectKnowledgeBaseFullApp.rendered.happy.test.tsx`
- [x] #118 Retrieve indexed knowledge in a project chat.
  - `__tests__/integration/knowledge-base/projectKnowledgeBaseFullApp.rendered.happy.test.tsx`
- [x] #119 New chat inherits the selected project.
  - `__tests__/integration/knowledge-base/projectKnowledgeBaseFullApp.rendered.happy.test.tsx`
- [x] #122 Deleting a project handles its chats safely.
  - `__tests__/integration/projects/deleteProjectChatsFullApp.rendered.happy.test.tsx`

### Tools and MCP

- [ ] #123 Calculator tool runs and renders its result.
- [ ] #127 Parallel tool calls both complete.
- [ ] #129 Messy tool JSON is parsed without leaking markup.
- [x] #132 Empty final model turn retains visible tool data.
  - `__tests__/integration/chat/toolEmptyFinalFullApp.rendered.redflow.test.tsx`
  - Full App -> Home model selection -> Chat lazy load -> quick settings -> Tools -> Calculator -> send; when the native model returns a successful calculator call and an empty final turn, the rendered assistant answer retains `2+2 = 4` with no blank/`(No response)` state.
- [x] #133 Add and connect an MCP server.
  - `__tests__/integration/tools/mcpFullApp.rendered.happy.test.tsx`
- [x] #134 Connected MCP tools are listed.
  - `__tests__/integration/tools/mcpFullApp.rendered.happy.test.tsx`
- [x] #135 Execute an MCP tool and render its result.
  - `__tests__/integration/tools/mcpFullApp.rendered.happy.test.tsx`

### Remote models

- [ ] #138 Remote model replies.
- [ ] #142 LM Studio reasoning renders.
- [ ] #143 Remote parallel tool calls complete.
- [x] #144 Remote prompt enhancement runs.
  - `__tests__/integration/generation/remoteEnhancementFullApp.rendered.happy.test.tsx`
- [x] #145 Remote server loss clears generation and surfaces an error.
  - `__tests__/integration/generation/remoteDisconnectMidGenerationFullApp.rendered.redflow.test.tsx`

### Prompt enhancement and TTS

- [ ] #150 Enhancement request disables thinking.
- [ ] #151 Enhanced prompt is a clean rewrite without reasoning markers.
- [ ] #154 Speak an assistant reply.
- [ ] #155 Spoken text strips Markdown and control markup.

### Security, persistence, and lifecycle

- [ ] #164 Set and enforce an app-lock passphrase.
- [ ] #166 Settings persist across relaunch.
- [ ] #169 Active model selection survives relaunch.
- [x] #170 Projects and knowledge-base data survive relaunch.
  - `__tests__/integration/knowledge-base/projectKnowledgeBaseFullApp.rendered.happy.test.tsx`
- [x] #172 Background -> foreground during generation is coherent.
  - `__tests__/integration/generation/backgroundForegroundGenerationFullApp.rendered.happy.test.tsx`
- [x] #173 Kill during generation recovers without a stuck turn.
  - `__tests__/integration/generation/killMidGenerationRecoveryFullApp.rendered.redflow.test.tsx`
- [~] #174 Local generation still works in airplane mode.
  - `__tests__/integration/generation/airplaneModeLocalFullApp.rendered.happy.test.tsx`; physical radio-off action remains.

### This release

- [ ] #182 Parse-once thinking + tool + answer on LiteRT.
- [ ] #183 Parse-once thinking + tool + answer on remote.
- [x] #184 Activating remote frees the local heavy model.
  - `__tests__/integration/memory/remoteActivationFreesLocalFullApp.rendered.happy.test.tsx`
- [x] #185 Mid-chat model switch stays coherent.
  - `__tests__/integration/generation/midChatModelSwitchFullApp.rendered.redflow.test.tsx`
- [x] #186 Remote stream interruption recovers.
  - `__tests__/integration/generation/remoteDisconnectMidGenerationFullApp.rendered.redflow.test.tsx`
- [x] #188 LiteRT download warning is device-aware on both screens.
  - `__tests__/integration/models/litertWarningBothScreensFullApp.rendered.happy.test.tsx`
- [ ] #190 Send racing settings reload keeps thinking capability.
- [ ] #191 GPU -> CPU fallback is visibly reported.
- [ ] #192 Mic during STT download is not shown as a model loader.
- [ ] #193 New generation clears a stale failure card.
- [x] #194 Embedded MTP activates only for capable GGUFs and safely falls back.
- [x] #196 Model file-list failure renders Retry and recovers.

## Removed count inflation

- The pure LiteRT router behavior now lives under `unit/services`.
- The direct-store reasoning render duplicated narrower grammar/parser contracts and was removed.
- The synthetic share-prompt host duplicated the scheduler and sheet contracts and was removed.
- The direct-store image-settings suite was removed; its reset/parity behavior remains an open real-App
  journey and does not count as integration coverage.
