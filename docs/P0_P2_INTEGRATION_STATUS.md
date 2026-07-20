# App-wide P0-P3 integration risk inventory

This is the living, conservative evidence audit for the whole app. Product
screens, navigation, services, stores, persistence, lifecycle behavior, native
boundaries, and Pro extension seams define the scope. The canonical
`docs/RELEASE_TEST_CHECKLIST.csv` is one traceability source, not the boundary of
the inventory. A row is credited only after its real rendered/native journey has
been mapped, rerun, and shown to prove the user-visible behavior. An audit-pending
row does **not** mean that no test exists.

## Summary

- Current scope: **245 journeys** - **33 P0**, **118 P1**, **84 P2**, and **10 P3**.
- The runnable release checklist contains 247 execution rows. The app-derived inventory is
  maintained separately and can overlap those rows, including the first P3 set.
- P0: **24 verified**, **9 partial/device-gated**, **0 confirmed gaps**, **0 audit pending**.
- P1: **115 verified**, **3 partial/device-gated**, **0 confirmed gaps**, **0 audit pending**.
- P2: **83 verified**, **1 partial/device-gated**, **0 confirmed gaps**, **0 audit pending**.
- P3: **0 verified**, **0 partial/device-gated**, **0 confirmed gaps**, **10 audit pending**.
- `[x]` verified; `[~]` automated portion verified with a physical-device gate left; `[ ]` confirmed coverage gap; `[?]` evidence audit pending.
- This file is updated as journeys are verified or product fixes land.

## Priority model

- **P0:** app availability, security boundary, irreversible data loss, or the core
  offline model/download/chat path is unusable.
- **P1:** a primary workflow is broken, state becomes inconsistent, or a common
  failure cannot recover without reinstalling or losing work.
- **P2:** a secondary workflow, management surface, or uncommon recovery path is
  broken but the core app remains usable.
- **P3:** polish, accessibility, layout, scale, and rare interaction edges that do
  not corrupt data or block the main workflow.

## App-derived additions beyond the release checklist

### P0 additions

- [x] APP-P0-001 Corrupt persisted app settings do not trap startup or wipe unrelated user data
- [x] APP-P0-002 Persisted schema migrations retain chats, projects, models, and settings across old versions
- [x] APP-P0-003 Partial database or filesystem initialization failure still reaches a recoverable screen
- [x] APP-P0-004 Interrupted persistence writes do not erase previously committed chats or projects
- [x] APP-P0-005 Lock state cannot be bypassed by cold start, background resume, or direct navigation
- [x] APP-P0-006 Pro extension load failure cannot crash or disable the core app

### P1 additions

- [x] APP-P1-001 Cancelling a running download removes only that transfer and leaves a retriable state
  - `__tests__/integration/downloads/cancelAndDuplicateDownloadFullApp.rendered.happy.test.tsx`
- [x] APP-P1-002 Cancelling a queued download prevents it from resurrecting after relaunch
  - `__tests__/integration/downloads/queuedDownloadsKillDrainFullApp.rendered.happy.test.tsx`
- [x] APP-P1-003 Repeated download taps coalesce to one native transfer and one visible row
  - `__tests__/integration/downloads/cancelAndDuplicateDownloadFullApp.rendered.happy.test.tsx`
- [x] APP-P1-004 Foreground download hydration deduplicates native, persisted, and newer in-memory state
  - `__tests__/integration/downloads/foregroundHydrationDedupFullApp.rendered.happy.test.tsx`
- [x] APP-P1-005 Deleting the active resident model unloads it and selects a coherent fallback
  - `__tests__/integration/models/deleteActiveResidentFallbackFullApp.rendered.happy.test.tsx`
- [x] APP-P1-006 Local model import accepts a compatible file and rejects incompatible or partial files clearly
  - `__tests__/integration/models/localModelImportValidationFullApp.rendered.redflow.test.tsx`
- [x] APP-P1-007 Missing or corrupt downloaded files self-heal the model list without a phantom ready model
  - `__tests__/integration/models/missingCorruptModelSelfHealFullApp.rendered.redflow.test.tsx`
- [x] APP-P1-008 Create, rename, open, and delete conversations preserve the correct active chat
  - `__tests__/integration/chat/conversationCrudFullApp.rendered.happy.test.tsx`
- [x] APP-P1-009 Attachments are copied durably and a missing attachment after relaunch fails gracefully
  - `__tests__/integration/chat/imageAttachmentDurabilityFullApp.rendered.redflow.test.tsx`
- [x] APP-P1-010 Context compaction persists its summary without dropping recent messages
  - `__tests__/integration/generation/litertCompactionPersistenceFullApp.rendered.happy.test.tsx`
- [x] APP-P1-011 Gallery deletion removes the file and updates the grid without stale thumbnails
  - `__tests__/integration/gallery/galleryDeleteFullApp.rendered.happy.test.tsx`
- [x] APP-P1-012 Deleting a KB document removes its index and prevents stale retrieval
  - `__tests__/integration/knowledge-base/projectKnowledgeBaseFullApp.rendered.happy.test.tsx`
- [x] APP-P1-013 Replacing or re-indexing a KB document cannot mix old and new chunks
  - `__tests__/integration/knowledge-base/projectKnowledgeBaseFullApp.rendered.happy.test.tsx`
- [x] APP-P1-014 Add, edit, delete, and switch remote servers recover active model selection coherently
  - `__tests__/integration/remote/remoteServerLifecycleFullApp.rendered.happy.test.tsx`
- [x] APP-P1-015 Remote authentication failures are actionable and never expose credentials in UI or logs
  - `__tests__/integration/remote/remoteServerLifecycleFullApp.rendered.happy.test.tsx`
- [x] APP-P1-016 Pro activation registers routes live; entitlement revocation removes gated behavior safely
  - `__tests__/integration/onboarding/proEntitlementFullApp.rendered.happy.test.tsx`
- [x] APP-P1-017 Experimental MTP defaults off, persists explicitly, and never changes ordinary GGUF behavior
- [x] APP-P1-018 Background locking and unlock preserve the current conversation without exposing its content
  - `__tests__/integration/app/appLockCannotBypassFullApp.rendered.redflow.test.tsx`
- [x] APP-P1-019 Android Gemma LiteRT vision preserves the image and recovers when native context is RAM-clamped

### P2 additions

- [x] APP-P2-001 Model search, filters, and tabs retain coherent results through downloads and deletion
  - `__tests__/integration/models/modelBrowseLifecycleFullApp.rendered.happy.test.tsx`
- [x] APP-P2-002 Home and chat model pickers show the same active, downloaded, and resident state
  - `__tests__/integration/models/homeChatPickerParityFullApp.rendered.happy.test.tsx`
- [x] APP-P2-003 Download Manager cancel, retry, queued, processing, and terminal states expose valid actions
  - `__tests__/integration/downloads/cancelAndDuplicateDownloadFullApp.rendered.happy.test.tsx`
  - `__tests__/integration/downloads/queuedDownloadsKillDrainFullApp.rendered.happy.test.tsx`
  - `__tests__/integration/downloads/imageExtractionKillRelaunchFullApp.rendered.redflow.test.tsx`
- [x] APP-P2-004 Orphaned-file cleanup never removes a downloaded, active, or in-flight model file
  - `__tests__/integration/settings/storageMaintenanceFullApp.rendered.happy.test.tsx`
- [x] APP-P2-005 Cache clearing updates storage totals and preserves user conversations and models
  - `__tests__/integration/settings/storageMaintenanceFullApp.rendered.happy.test.tsx`
- [x] APP-P2-006 Tool enablement and disablement persist and affect only subsequent turns
  - `__tests__/integration/tools/toolTogglePersistenceFullApp.rendered.happy.test.tsx`
- [x] APP-P2-007 MCP servers reconnect after relaunch without duplicate clients, tools, or routes
  - `__tests__/integration/tools/mcpFullApp.rendered.happy.test.tsx`
- [x] APP-P2-008 MCP OAuth cancel, expiry, refresh, and retry return to an actionable state
  - `__tests__/integration/tools/mcpOAuthLifecycleFullApp.rendered.happy.test.tsx`
  - `pro/__tests__/unit/mcpOAuth.test.ts`
  - `__tests__/unit/services/mcpOAuthNativeAdapters.test.ts`
- [x] APP-P2-009 LAN discovery deduplicates repeated scans and supports multiple configured servers
  - `__tests__/integration/settings/lanDiscoveryRepeatFullApp.rendered.happy.test.tsx`
- [x] APP-P2-010 Supported document types import and preview with stable names and metadata
  - `__tests__/integration/knowledge-base/projectKnowledgeBaseFullApp.rendered.happy.test.tsx`
- [x] APP-P2-011 Every Settings card opens its registered screen and returns without losing tab state
  - `__tests__/integration/settings/settingsNavigation.rendered.happy.test.tsx`
- [x] APP-P2-012 External community and support links fail gracefully when no handler is available
  - `__tests__/integration/settings/settingsPolishFullApp.rendered.happy.test.tsx`
- [x] APP-P2-013 Debug logs can be viewed, exported, and cleared without leaking secrets
  - `__tests__/integration/settings/settingsPolishFullApp.rendered.happy.test.tsx`
  - `__tests__/unit/utils/logSanitizer.test.ts`
- [x] APP-P2-014 Dynamic Pro settings and screen registration stays deduplicated across refresh and reactivation
  - `__tests__/integration/onboarding/proEntitlementFullApp.rendered.happy.test.tsx`

### P3 additions

- [?] APP-P3-001 Primary controls expose meaningful accessibility roles, names, values, and disabled state
- [?] APP-P3-002 Screen-reader focus order and progress announcements follow the visible workflow
- [?] APP-P3-003 Dynamic type does not clip critical actions, alerts, settings values, or message controls
- [?] APP-P3-004 Keyboard, safe-area, and bottom-sheet transitions never hide the composer or confirmation actions
- [?] APP-P3-005 Small-phone and tablet layouts keep navigation, cards, modals, and previews usable
- [?] APP-P3-006 Rapid repeated taps on send, retry, delete, load, and record remain idempotent
- [?] APP-P3-007 Long model, project, document, server, and conversation names wrap or truncate accessibly
- [?] APP-P3-008 Large chat, model, project, and gallery collections remain responsive and scroll correctly
- [?] APP-P3-009 Light, dark, and system themes preserve readable contrast across alerts and transient states
- [?] APP-P3-010 Back gestures during loading, recording, generation, and modal presentation clean up safely

## Release checklist traceability

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
- [~] #54 Chat-mode dictation on litert - strict full-App realtime and direct-audio coverage exists; physical-device action remains
- [~] #55 Voice note carries transcript (chat mode) - strict full-App transcript-only coverage exists; physical-device action remains
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
- [~] #101 Load Anyway bypasses a cautious refusal when the survival check is safe - the full-App
  override journey is automated; physical-device native loading remains

### 11 Polish

- [x] #167 Chat history survives relaunch
- [x] #168 Downloaded models survive relaunch
- [x] #171 Download entries survive relaunch

### 12 This-release

- [~] #180 Gemma-4 native-first thinking + tool - strict full-App reasoning/tool ordering coverage exists; physical-device action remains
- [x] #181 Upgrade-over-install keeps data + loading mode - Android 16 physical-device pass (2026-07-17): installed this debug build over the existing 0.0.103 dev app without clearing data; 11 text, 2 image, 1 voice, and 3 speech models, 19 chats, 11 gallery images, and Pro entitlement remained; persisted storage still contained `modelLoadingMode: aggressive`
- [~] #187 Queued downloads survive app kill - strict full-App UI queue/relaunch/drain coverage exists; physical-device action remains
- [x] #195 Boot is independent of download database recovery

### 14 Device-only legacy

- [~] #215 Cold Whisper load has no ghost recording - the full-App release-during-load
  and clean next-take journey is automated; the physical OS privacy indicator remains a
  device gate
  - `__tests__/integration/audio/whisperStartSupersededNoGhost.redflow.test.tsx`

## P1

### 0 Install

- [x] #2 Complete onboarding

### 1 Downloads

- [x] #7 Download a vision model (mmproj)
- [x] #8 Downloads badge count matches manager
- [x] #12 Download an image model
- [~] #13 Download a LARGE text model - automated coverage exists; physical-device action remains
- [x] #14 Download a litert model
- [x] #15 Delete does not cancel another download
- [x] #16 Concurrent / queued downloads — `__tests__/integration/downloads/queuedDownloadsKillDrainFullApp.rendered.happy.test.tsx`
- [x] #17 Download with NO network
- [x] #19 Truncated file not listed as ready
- [x] #20 Kill mid-extraction recovers
- [x] #21 Retry a failed image extraction

### 2 Text gen

- [x] #24 First message replies (litert)
- [x] #25 GPU/OpenCL backend
- [x] #28 GPU layers slider applies
- [x] #29 litert CPU backend fails gracefully
- [x] #30 NPU/HTP backend gated or graceful
- [x] #31 Temperature applies to a generation
- [x] #33 Context length applies
- [x] #34 System prompt applies
- [x] #38 Plain reply has no stray think tags
- [x] #39 Thinking renders in block mid-stream
- [x] #44 Queue while generating
- [x] #46 Edit a user message and resend
- [x] #47 Regenerate a reply
- [x] #48 Mid-conversation sampler change takes effect

### 3 Voice

- [x] #51 Mic permission prompt on first record — `__tests__/integration/audio/microphonePermissionFullApp.rendered.happy.test.tsx`
- [x] #52 Mic permission DENIED handled gracefully — `__tests__/integration/audio/microphonePermissionFullApp.rendered.happy.test.tsx`
- [x] #56 Voice note transcript on litert + tool — `__tests__/integration/audio/voiceModeCalculatorJourney.rendered.happy.test.tsx`
- [x] #57 Mic stops cleanly on leave
- [x] #59 Voice-mode transcript renders
- [x] #61 Voice draw-request routes to image
- [x] #62 Voice calculator journey
- [x] #63 Voice-mode Stop button while generating

### 4 Image

- [x] #67 Image Size + Guidance honored
- [x] #69 Image steps applies
- [x] #70 Tap image opens fullscreen preview
- [x] #72 Non-draw prompt routes to text — `__tests__/integration/generation/nonDrawRoutesToTextFullApp.rendered.happy.test.tsx`
- [x] #73 Resend of an image request re-draws

### 4 Vision

- [x] #80 Vision answers about an image
- [x] #82 Big vision model decode handled — `__tests__/integration/generation/visionDecodeRecoveryFullApp.rendered.redflow.test.tsx`
- [x] #83 litert vision affordance consistent
- [x] #84 Non-vision model image is refused gracefully

### 5 Memory

- [x] #89 Text + whisper co-reside (roomy)
- [x] #90 Sidecars co-reside with a heavy
- [x] #94 Idle STT reclaimed in a voice turn
- [x] #95 Whisper blocked then freed then retried
- [~] #96 OS memory-warning evicts idle sidecars - strict full-App warning/reclaim coverage exists; physical-device pressure remains
- [x] #97 Aggressive loads bigger automatically — `__tests__/integration/memory/aggressiveLargerModelFullApp.rendered.happy.test.tsx`
- [x] #100 Estimators agree (no safe-then-refuse) — `__tests__/integration/memory/imageToChatSwapFullApp.rendered.happy.test.tsx`
- [x] #102 Survival floor blocks a guaranteed OOM —
      `__tests__/integration/memory/survivalFloorFullApp.rendered.happy.test.tsx`
- [x] #103 Image->chat swap — `__tests__/integration/memory/imageToChatSwapFullApp.rendered.happy.test.tsx`
- [x] #104 Switch active model mid-chat — `__tests__/integration/generation/midChatModelSwitchFullApp.rendered.redflow.test.tsx`
- [x] #105 Eject All frees everything
- [x] #106 Eject one resident from In Memory
- [x] #107 Lazy reload after eject
- [x] #108 In Memory shows loaded model RAM
- [x] #109 Stale TTS pressure cleared on delete — `__tests__/integration/memory/ttsDeleteClearsResidencyFullApp.rendered.happy.test.tsx`

### 6 KB/Projects

- [x] #112 Create a project
- [x] #113 KB indexes a text PDF — `__tests__/integration/knowledge-base/projectKnowledgeBaseFullApp.rendered.happy.test.tsx`
- [x] #117 Embedding failure aborts + retry — `__tests__/integration/knowledge-base/projectKnowledgeBaseFullApp.rendered.happy.test.tsx`
- [x] #118 KB retrieval in a chat — `__tests__/integration/knowledge-base/projectKnowledgeBaseFullApp.rendered.happy.test.tsx`
- [x] #119 New chat inherits the project — `__tests__/integration/knowledge-base/projectKnowledgeBaseFullApp.rendered.happy.test.tsx`
- [x] #122 Delete project handles its chats — `__tests__/integration/projects/deleteProjectChatsFullApp.rendered.happy.test.tsx`

### 7 Tools

- [x] #123 Calculator tool runs
- [x] #127 Parallel tool calls
- [x] #129 Messy tool JSON still runs
- [x] #132 Empty final turn keeps tool data
  - `__tests__/integration/chat/toolEmptyFinalFullApp.rendered.redflow.test.tsx`
- [x] #133 Add / connect an MCP server
  - `__tests__/integration/tools/mcpFullApp.rendered.happy.test.tsx`
- [x] #134 MCP server tools listed
  - `__tests__/integration/tools/mcpFullApp.rendered.happy.test.tsx`
- [x] #135 Execute an MCP tool
  - `__tests__/integration/tools/mcpFullApp.rendered.happy.test.tsx`

### 8 Remote

- [x] #138 Remote model replies
- [x] #142 Remote reasoning renders (LM Studio)
- [x] #143 Remote parallel tool calls
- [x] #144 Remote prompt-enhance runs
  - `__tests__/integration/generation/remoteEnhancementFullApp.rendered.happy.test.tsx`
- [x] #145 Remote server dies mid-generation

### 9 Enhancement

- [x] #150 Enhancement request carries no thinking
- [x] #151 Enhanced prompt is a clean rewrite

### 10 TTS

- [x] #154 Speak a reply
- [x] #155 TTS text is markdown-stripped

### 11 Polish

- [x] #164 App lock passphrase set + enforce
- [x] #166 Settings persist across relaunch
- [x] #169 Active model selection survives relaunch
- [x] #170 Projects + KB survive relaunch — `__tests__/integration/knowledge-base/projectKnowledgeBaseFullApp.rendered.happy.test.tsx`
- [x] #172 Background -> foreground mid-generation — `__tests__/integration/generation/backgroundForegroundGenerationFullApp.rendered.happy.test.tsx`
- [x] #173 Kill mid-generation recovers — `__tests__/integration/generation/killMidGenerationRecoveryFullApp.rendered.redflow.test.tsx`
- [~] #174 Airplane mode local-only still works — `__tests__/integration/generation/airplaneModeLocalFullApp.rendered.happy.test.tsx`; physical radio-off action remains

### 12 This-release

- [x] #182 Parse-once thinking+tool+answer on litert
- [x] #183 Parse-once thinking+tool+answer on remote
- [x] #184 Remote activation frees local heavy — `__tests__/integration/memory/remoteActivationFreesLocalFullApp.rendered.happy.test.tsx`
- [x] #185 Mid-chat model switch stays coherent — `__tests__/integration/generation/midChatModelSwitchFullApp.rendered.redflow.test.tsx`
- [x] #186 Remote stream interruption recovers — `__tests__/integration/generation/remoteDisconnectMidGenerationFullApp.rendered.redflow.test.tsx`
- [x] #188 Litert download warning is device-aware (BOTH screens) — `__tests__/integration/models/litertWarningBothScreensFullApp.rendered.happy.test.tsx`
- [x] #190 Send racing a settings reload keeps thinking
- [x] #191 GPU->CPU fallback is visibly reported
- [x] #192 Mic during a background STT download is not a loader
- [x] #193 Stale failure card cleared when a new attempt starts
- [x] #194 Embedded MTP activates only for capable GGUFs
- [x] #196 Model file-list failure is retryable

### 15 Retained PR558

- [~] #241 Image download Wi-Fi failure retries and finalizes - the full-App
  failure, Download Manager Retry, resumed progress, archive finalization, and
  single ready-model journey is automated; the physical radio transition remains
  a device gate
  - `__tests__/integration/downloads/imageNetworkRetryFinalizesFullApp.rendered.redflow.test.tsx`

## P2

### 0 Install

- [x] #3 Onboarding skip when server+model already set

### 1 Downloads

- [x] #5 Downloaded model shows Downloaded indicator
- [x] #6 Model info / credibility shown on the card
- [x] #10 Download a second whisper model
- [x] #22 Install the bundled embedding model on first KB use —
      `__tests__/integration/knowledge-base/projectKnowledgeBaseFullApp.rendered.happy.test.tsx`

### 2 Text gen

- [x] #26 CPU backend (GGUF)
- [x] #27 GPU init timeout falls back to CPU —
      `__tests__/integration/generation/ggufGpuFallbackFullApp.rendered.redflow.test.tsx`
- [x] #32 Top-P applies to a generation
- [x] #35 CPU threads applies
- [x] #36 Batch size applies
- [x] #37 Flash attention toggle applies
- [x] #40 Thinking header reads Thinking while streaming
- [x] #41 Long output cutoff indicator
- [x] #45 Copy a message
- [x] #49 Reset to Defaults (text params)
- [x] #50 Context-full new-chat prompt

### 3 Voice

- [x] #58 Double-tap mic no collision
- [x] #64 No stray empty bubble in voice tool turn
- [x] #65 Voice thinking block width + alignment

### 4 Image

- [x] #68 Image size floors at 256
- [x] #71 Tap attached (pre-send) image previews
- [x] #74 Reset to Defaults resets image params
- [x] #75 Chat-modal vs Model-Settings sliders agree
- [x] #76 First-gen warmup notice is accurate
- [x] #77 Generated images appear in Gallery

### 4 Vision

- [x] #78 Photo permission prompt on first attach
- [x] #79 Photo permission DENIED handled gracefully
- [x] #81 Image + text in one turn

### 5 Memory

- [x] #91 TTS co-resident in a voice turn
- [x] #92 Embedding sidecar resident on KB embed
- [x] #98 Aggressive does not over-commit dirty
- [x] #110 Delete mid-playback does not kill audio
- [x] #111 Device info memory readout

### 6 KB/Projects

- [x] #114 Preview a KB document - `__tests__/integration/knowledge-base/projectKnowledgeBaseFullApp.rendered.happy.test.tsx`
- [x] #115 Scanned PDF clear message - `__tests__/integration/knowledge-base/kbScannedPdfMessage.rendered.redflow.test.tsx`
- [x] #116 >5MB file rejected - `__tests__/integration/knowledge-base/kbFileSizeGuard.rendered.happy.test.tsx`
- [x] #120 Context-full new chat keeps project - `__tests__/integration/generation/contextFullNewChatFullApp.rendered.redflow.test.tsx`
- [x] #121 Edit a project - `__tests__/integration/projects/createProjectFullApp.rendered.happy.test.tsx`

### 7 Tools

- [x] #124 Datetime tool runs
- [x] #125 Device info tool runs
- [x] #126 Web search tool runs
- [x] #128 Thinking + tool + answer render in order
- [x] #130 Stringified tool args parsed
- [x] #131 Tool router no false positive - `__tests__/integration/chat/toolRouterFalsePositive.redflow.test.ts`
- [x] #136 MCP tool error handled - `__tests__/integration/tools/mcpFullApp.rendered.happy.test.tsx`
- [x] #137 MCP guide screen renders - `__tests__/integration/tools/mcpFullApp.rendered.happy.test.tsx`

### 8 Remote

- [x] #139 No phantom servers on empty scan
- [x] #140 Remote model has a visible indicator
- [x] #141 Remote reasoning renders (Ollama) - `__tests__/integration/generation/remoteOllamaReasoningRenders.rendered.redflow.test.tsx`
- [x] #146 Remote request timeout - `__tests__/integration/generation/remoteFailureRecoveryFullApp.rendered.redflow.test.tsx`
- [x] #147 Malformed remote response handled - `__tests__/integration/generation/remoteFailureRecoveryFullApp.rendered.redflow.test.tsx`
- [x] #148 Local select makes the model active - `__tests__/integration/generation/remoteFailureRecoveryFullApp.rendered.redflow.test.tsx`
- [x] #149 Home Text count truthful with remote active

### 9 Enhancement

- [x] #152 Enhancement shows progress
- [x] #153 Enhancement rewrites then regenerates

### 11 Polish

- [x] #156 Theme switch applies (System/Light/Dark) - `__tests__/integration/settings/settingsPolishFullApp.rendered.happy.test.tsx`
- [x] #157 Empty state: no models
- [x] #158 Empty state: no chats
- [x] #159 Empty state: no KB docs
- [x] #160 Long-text wrapping - `__tests__/integration/generation/longTextWrappingFullApp.rendered.happy.test.tsx`
- [x] #161 Orientation behavior - `__tests__/integration/settings/settingsPolishFullApp.rendered.happy.test.tsx`
- [x] #162 About screen renders
- [x] #163 Storage usage screen
- [x] #165 Share/promo sheet once per session
- [~] #175 Thermal / long-context stress - deterministic context-full recovery,
  compaction persistence, survival floors, and OS-memory-warning handling are automated;
  sustained real-device thermal throttling and jetsam remain a release device gate
  - `__tests__/integration/generation/contextFullNewChatFullApp.rendered.redflow.test.tsx`
  - `__tests__/integration/generation/litertCompactionPersistenceFullApp.rendered.happy.test.tsx`
  - `__tests__/integration/memory/survivalFloorFullApp.rendered.happy.test.tsx`
  - `__tests__/integration/memory/osMemoryWarningFullApp.rendered.happy.test.tsx`
- [x] #176 Stay-in-the-loop card placement - `__tests__/integration/settings/settingsPolishFullApp.rendered.happy.test.tsx`
- [x] #177 Follow on X opens the profile - `__tests__/integration/settings/settingsPolishFullApp.rendered.happy.test.tsx`
- [x] #178 Join Slack opens the invite - `__tests__/integration/settings/settingsPolishFullApp.rendered.happy.test.tsx`
- [x] #179 Share on X prefilled - `__tests__/integration/settings/settingsPolishFullApp.rendered.happy.test.tsx`

### 12 This-release

- [x] #189 TTS download respects the concurrency cap
