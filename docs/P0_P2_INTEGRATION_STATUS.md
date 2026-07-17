# P0-P2 integration status

This is the living, conservative status for the canonical `docs/RELEASE_TEST_CHECKLIST.csv`.
A row is credited only when a real rendered/native journey proves the user-visible behavior.

## Summary

- Canonical scope: **196 journeys** - **27 P0**, **99 P1**, and **70 P2**.
- The canonical checklist currently contains **no P3 rows**.
- P0: **17 covered**, **7 partial/device-gated**, **3 not yet credited**.
- P1: **8 covered**, **0 partial/device-gated**, **91 not yet credited**.
- P2: **0 covered**, **0 partial/device-gated**, **70 not yet credited**.
- `[x]` covered; `[~]` automated portion covered with a physical-device gate left; `[ ]` confirmed open; `[?]` evidence audit pending.
- This file is updated as journeys are verified or product fixes land.

## P0

### 0 Install

- [~] #1 Fresh install launches - automated coverage exists; physical-device action remains

### 1 Downloads

- [x] #4 Download a text (GGUF) model
- [x] #9 Download an STT (whisper) model
- [x] #11 Download a TTS (voice) model
- [~] #18 Interrupted download recovers after relaunch - automated coverage exists; physical-device action remains

### 2 Text gen

- [x] #23 First message loads + replies (GGUF)
- [x] #42 Failed generation clears the spinner
- [x] #43 Stop mid-generation keeps partial

### 3 Voice

- [~] #53 Chat-mode dictation to composer - automated coverage exists; physical-device action remains
- [~] #54 Chat-mode dictation on litert - automated coverage exists; physical-device action remains
- [~] #55 Voice note carries transcript (chat mode) - automated coverage exists; physical-device action remains
- [~] #60 Full voice-mode journey (STT->reply->TTS) - automated coverage exists; physical-device action remains

### 4 Image

- [x] #66 Image generates and renders

### 5 Memory

- [x] #85 Loading mode selectable + persists
- [x] #86 Whisper not resident on download
- [x] #87 Conservative = one heavy at a time
- [x] #88 Balanced = co-reside if they fit
- [x] #93 Idle STT reclaimed for a text turn
- [x] #99 Oversized model shows a graceful card
- [~] #101 Load Anyway always loads - automated coverage exists; physical-device action remains

### 11 Polish

- [x] #167 Chat history survives relaunch
- [x] #168 Downloaded models survive relaunch
- [x] #171 Download entries survive relaunch

### 12 This-release

- [ ] #180 Gemma-4 native-first thinking + tool
- [ ] #181 Upgrade-over-install keeps data + loading mode
- [ ] #187 Queued downloads survive app kill
- [x] #195 Boot is independent of download database recovery

## P1

### 0 Install

- [x] #2 Complete onboarding

### 1 Downloads

- [x] #7 Download a vision model (mmproj)
- [x] #8 Downloads badge count matches manager
- [x] #12 Download an image model
- [ ] #13 Download a LARGE text model
- [x] #14 Download a litert model
- [ ] #15 Delete does not cancel another download
- [ ] #16 Concurrent / queued downloads
- [x] #17 Download with NO network
- [ ] #19 Truncated file not listed as ready
- [ ] #20 Kill mid-extraction recovers
- [ ] #21 Retry a failed image extraction

### 2 Text gen

- [ ] #24 First message replies (litert)
- [ ] #25 GPU/OpenCL backend
- [ ] #28 GPU layers slider applies
- [ ] #29 litert CPU backend fails gracefully
- [ ] #30 NPU/HTP backend gated or graceful
- [ ] #31 Temperature applies to a generation
- [ ] #33 Context length applies
- [ ] #34 System prompt applies
- [ ] #38 Plain reply has no stray think tags
- [ ] #39 Thinking renders in block mid-stream
- [ ] #44 Queue while generating
- [ ] #46 Edit a user message and resend
- [ ] #47 Regenerate a reply
- [ ] #48 Mid-conversation sampler change takes effect

### 3 Voice

- [ ] #51 Mic permission prompt on first record
- [ ] #52 Mic permission DENIED handled gracefully
- [ ] #56 Voice note transcript on litert + tool
- [ ] #57 Mic stops cleanly on leave
- [ ] #59 Voice-mode transcript renders
- [ ] #61 Voice draw-request routes to image
- [ ] #62 Voice calculator journey
- [ ] #63 Voice-mode Stop button while generating

### 4 Image

- [ ] #67 Image Size + Guidance honored
- [ ] #69 Image steps applies
- [ ] #70 Tap image opens fullscreen preview
- [ ] #72 Non-draw prompt routes to text
- [ ] #73 Resend of an image request re-draws

### 4 Vision

- [ ] #80 Vision answers about an image
- [ ] #82 Big vision model decode handled
- [ ] #83 litert vision affordance consistent
- [ ] #84 Non-vision model image is refused gracefully

### 5 Memory

- [ ] #89 Text + whisper co-reside (roomy)
- [ ] #90 Sidecars co-reside with a heavy
- [ ] #94 Idle STT reclaimed in a voice turn
- [ ] #95 Whisper blocked then freed then retried
- [ ] #96 OS memory-warning evicts idle sidecars
- [ ] #97 Aggressive loads bigger automatically
- [ ] #100 Estimators agree (no safe-then-refuse)
- [ ] #102 Survival floor blocks a guaranteed OOM
- [ ] #103 Image->chat swap
- [ ] #104 Switch active model mid-chat
- [ ] #105 Eject All frees everything
- [ ] #106 Eject one resident from In Memory
- [ ] #107 Lazy reload after eject
- [ ] #108 In Memory shows loaded model RAM
- [ ] #109 Stale TTS pressure cleared on delete

### 6 KB/Projects

- [ ] #112 Create a project
- [ ] #113 KB indexes a text PDF
- [ ] #117 Embedding failure aborts + retry
- [ ] #118 KB retrieval in a chat
- [ ] #119 New chat inherits the project
- [ ] #122 Delete project handles its chats

### 7 Tools

- [ ] #123 Calculator tool runs
- [ ] #127 Parallel tool calls
- [ ] #129 Messy tool JSON still runs
- [ ] #132 Empty final turn keeps tool data
- [ ] #133 Add / connect an MCP server
- [ ] #134 MCP server tools listed
- [ ] #135 Execute an MCP tool

### 8 Remote

- [ ] #138 Remote model replies
- [ ] #142 Remote reasoning renders (LM Studio)
- [ ] #143 Remote parallel tool calls
- [ ] #144 Remote prompt-enhance runs
- [ ] #145 Remote server dies mid-generation

### 9 Enhancement

- [ ] #150 Enhancement request carries no thinking
- [ ] #151 Enhanced prompt is a clean rewrite

### 10 TTS

- [ ] #154 Speak a reply
- [ ] #155 TTS text is markdown-stripped

### 11 Polish

- [ ] #164 App lock passphrase set + enforce
- [ ] #166 Settings persist across relaunch
- [ ] #169 Active model selection survives relaunch
- [ ] #170 Projects + KB survive relaunch
- [ ] #172 Background -> foreground mid-generation
- [ ] #173 Kill mid-generation recovers
- [ ] #174 Airplane mode local-only still works

### 12 This-release

- [ ] #182 Parse-once thinking+tool+answer on litert
- [ ] #183 Parse-once thinking+tool+answer on remote
- [ ] #184 Remote activation frees local heavy
- [ ] #185 Mid-chat model switch stays coherent
- [ ] #186 Remote stream interruption recovers
- [ ] #188 Litert download warning is device-aware (BOTH screens)
- [ ] #190 Send racing a settings reload keeps thinking
- [ ] #191 GPU->CPU fallback is visibly reported
- [ ] #192 Mic during a background STT download is not a loader
- [ ] #193 Stale failure card cleared when a new attempt starts
- [x] #194 Embedded MTP activates only for capable GGUFs
- [x] #196 Model file-list failure is retryable

## P2

### 0 Install

- [?] #3 Onboarding skip when server+model already set - existing-test evidence audit pending

### 1 Downloads

- [?] #5 Downloaded model shows Downloaded indicator - existing-test evidence audit pending
- [?] #6 Model info / credibility shown on the card - existing-test evidence audit pending
- [?] #10 Download a second whisper model - existing-test evidence audit pending
- [?] #22 Download an embedding model (first KB use) - existing-test evidence audit pending

### 2 Text gen

- [?] #26 CPU backend (GGUF) - existing-test evidence audit pending
- [?] #27 GPU init timeout falls back to CPU - existing-test evidence audit pending
- [?] #32 Top-P applies to a generation - existing-test evidence audit pending
- [?] #35 CPU threads applies - existing-test evidence audit pending
- [?] #36 Batch size applies - existing-test evidence audit pending
- [?] #37 Flash attention toggle applies - existing-test evidence audit pending
- [?] #40 Thinking header reads Thinking while streaming - existing-test evidence audit pending
- [?] #41 Long output cutoff indicator - existing-test evidence audit pending
- [?] #45 Copy a message - existing-test evidence audit pending
- [?] #49 Reset to Defaults (text params) - existing-test evidence audit pending
- [?] #50 Context-full new-chat prompt - existing-test evidence audit pending

### 3 Voice

- [?] #58 Double-tap mic no collision - existing-test evidence audit pending
- [?] #64 No stray empty bubble in voice tool turn - existing-test evidence audit pending
- [?] #65 Voice thinking block width + alignment - existing-test evidence audit pending

### 4 Image

- [?] #68 Image size floors at 256 - existing-test evidence audit pending
- [?] #71 Tap attached (pre-send) image previews - existing-test evidence audit pending
- [?] #74 Reset to Defaults resets image params - existing-test evidence audit pending
- [?] #75 Chat-modal vs Model-Settings sliders agree - existing-test evidence audit pending
- [?] #76 First-gen warmup notice is accurate - existing-test evidence audit pending
- [?] #77 Generated images appear in Gallery - existing-test evidence audit pending

### 4 Vision

- [?] #78 Photo permission prompt on first attach - existing-test evidence audit pending
- [?] #79 Photo permission DENIED handled gracefully - existing-test evidence audit pending
- [?] #81 Image + text in one turn - existing-test evidence audit pending

### 5 Memory

- [?] #91 TTS co-resident in a voice turn - existing-test evidence audit pending
- [?] #92 Embedding sidecar resident on KB embed - existing-test evidence audit pending
- [?] #98 Aggressive does not over-commit dirty - existing-test evidence audit pending
- [?] #110 Delete mid-playback does not kill audio - existing-test evidence audit pending
- [?] #111 Device info memory readout - existing-test evidence audit pending

### 6 KB/Projects

- [?] #114 Preview a KB document - existing-test evidence audit pending
- [?] #115 Scanned PDF clear message - existing-test evidence audit pending
- [?] #116 >5MB file rejected - existing-test evidence audit pending
- [?] #120 Context-full new chat keeps project - existing-test evidence audit pending
- [?] #121 Edit a project - existing-test evidence audit pending

### 7 Tools

- [?] #124 Datetime tool runs - existing-test evidence audit pending
- [?] #125 Device info tool runs - existing-test evidence audit pending
- [?] #126 Web search tool runs - existing-test evidence audit pending
- [?] #128 Thinking + tool + answer render in order - existing-test evidence audit pending
- [?] #130 Stringified tool args parsed - existing-test evidence audit pending
- [?] #131 Tool router no false positive - existing-test evidence audit pending
- [?] #136 MCP tool error handled - existing-test evidence audit pending
- [?] #137 MCP guide screen renders - existing-test evidence audit pending

### 8 Remote

- [?] #139 No phantom servers on empty scan - existing-test evidence audit pending
- [?] #140 Remote model has a visible indicator - existing-test evidence audit pending
- [?] #141 Remote reasoning renders (Ollama) - existing-test evidence audit pending
- [?] #146 Remote request timeout - existing-test evidence audit pending
- [?] #147 Malformed remote response handled - existing-test evidence audit pending
- [?] #148 Local select makes the model active - existing-test evidence audit pending
- [?] #149 Home Text count truthful with remote active - existing-test evidence audit pending

### 9 Enhancement

- [?] #152 Enhancement shows progress - existing-test evidence audit pending
- [?] #153 Enhancement rewrites then regenerates - existing-test evidence audit pending

### 11 Polish

- [?] #156 Theme switch applies (System/Light/Dark) - existing-test evidence audit pending
- [?] #157 Empty state: no models - existing-test evidence audit pending
- [?] #158 Empty state: no chats - existing-test evidence audit pending
- [?] #159 Empty state: no KB docs - existing-test evidence audit pending
- [?] #160 Long-text wrapping - existing-test evidence audit pending
- [?] #161 Orientation behavior - existing-test evidence audit pending
- [?] #162 About screen renders - existing-test evidence audit pending
- [?] #163 Storage usage screen - existing-test evidence audit pending
- [?] #165 Share/promo sheet once per session - existing-test evidence audit pending
- [?] #175 Thermal / long-context stress - existing-test evidence audit pending
- [?] #176 Stay-in-the-loop card placement - existing-test evidence audit pending
- [?] #177 Follow on X opens the profile - existing-test evidence audit pending
- [?] #178 Join Slack opens the invite - existing-test evidence audit pending
- [?] #179 Share on X prefilled - existing-test evidence audit pending

### 12 This-release

- [?] #189 TTS download respects the concurrency cap - existing-test evidence audit pending
