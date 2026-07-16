# Checklist Test Coverage Ledger

Maps every row of `docs/RELEASE_TEST_CHECKLIST.csv` (186 rows) to its existing test
coverage, so a later pass can write UI-behavior integration tests only for the genuine gaps.

Buckets:

- **HAS-UI-TEST** — a rendered/integration test mounts a screen with real gestures and asserts rendered UI (`render(`/`getByTestId`/`fireEvent`).
- **HAS-SERVICE-TEST-ONLY** — covered only by a service/unit test (no UI-level render).
- **NO-TEST** — no test covers it.
- **DEVICE-ONLY** — fundamentally cannot be a green jest test (native mic capture, real OOM/jetsam, OS permission dialogs, NPU firmware, thermal, on-kill process death, external-link browser opens, upgrade-over-install, real radio off, real bg/fg or rotation). These get NO jest test.

A row flagged HAS-UI-TEST may still carry a device caveat where the *trigger* is real-device (force-kill, native invoke) but the *rendered outcome* is covered.

---

## Phase 0 Install

| # | Phase | What to test | Bucket | Existing test (if any) | Note |
|---|---|---|---|---|---|
| 1 | 0 Install | Fresh install launches | DEVICE-ONLY | `__tests__/rntl/screens/OnboardingScreen.test.tsx` (partial) | Fresh-install/relaunch is device; onboarding-appears portion rendered |
| 2 | 0 Install | Complete onboarding | HAS-UI-TEST | `__tests__/rntl/screens/OnboardingScreen.test.tsx` | Renders onboarding, drives tap-through to end |
| 3 | 0 Install | Skip onboarding when server+model set | HAS-UI-TEST | `__tests__/integration/onboarding/serverModelConfiguredSkipsOnboarding.test.tsx` | T095; rendered, routes to Home |

## Phase 1 Downloads

| # | Phase | What to test | Bucket | Existing test (if any) | Note |
|---|---|---|---|---|---|
| 4 | 1 Downloads | Download a text (GGUF) model | HAS-UI-TEST | `__tests__/integration/models/startModelDownloadFlow.test.ts` + `__tests__/rntl/screens/ModelDownloadScreen.test.tsx` | Download flow via UI + generic coverage |
| 5 | 1 Downloads | Downloaded indicator per card | HAS-UI-TEST | `__tests__/integration/downloads/downloadedCountBadge.rendered.happy.test.tsx` | T012; rendered per-card downloaded mark |
| 6 | 1 Downloads | Model info / credibility on card | HAS-UI-TEST | `__tests__/rntl/components/ModelCard.test.tsx` | Renders credibility/quant/size badges |
| 7 | 1 Downloads | Vision model (mmproj) download | HAS-SERVICE-TEST-ONLY | `__tests__/unit/services/parallelMmproj.test.ts` | mmproj parallel download at service level; no UI mount |
| 8 | 1 Downloads | Downloads badge count matches manager | HAS-UI-TEST | `__tests__/integration/downloads/downloadCountDivergence.rendered.redflow.test.tsx` | T001/DEV-B7; rendered badge vs manager |
| 9 | 1 Downloads | Whisper NOT auto-loaded on download | HAS-UI-TEST | `__tests__/integration/memory/whisperResidentOnDownload.rendered.redflow.test.tsx` | DEV-B1/T022; rendered residency invariant |
| 10 | 1 Downloads | Download a second whisper model | HAS-SERVICE-TEST-ONLY | `__tests__/unit/services/sttDownloadProvider.test.ts` | Generic STT download at provider level |
| 11 | 1 Downloads | Download a TTS (Kokoro) model | HAS-SERVICE-TEST-ONLY | `__tests__/unit/audio/ttsDownloadProvider.test.ts` | TTS download at provider level; no UI download test |
| 12 | 1 Downloads | Image model download (extraction-gated) | HAS-SERVICE-TEST-ONLY | `__tests__/integration/models/imageDownloadRecovery.test.ts` | DEV-B4; readiness/extraction gating, non-rendered |
| 13 | 1 Downloads | Download a LARGE text model | HAS-SERVICE-TEST-ONLY | `__tests__/integration/models/startModelDownloadFlow.test.ts` | Generic flow; real size-hold is device |
| 14 | 1 Downloads | Download a litert model (Android) | NO-TEST | — | No litert-specific download test |
| 15 | 1 Downloads | Delete does not cancel another download | HAS-UI-TEST | `__tests__/integration/downloads/whisperDeleteCancelsOther.rendered.redflow.test.tsx` | T005/DEV-V1; rendered |
| 16 | 1 Downloads | Concurrent / queued downloads | HAS-SERVICE-TEST-ONLY | `__tests__/unit/services/backgroundDownloadService.test.ts` | Concurrency queue (max 3) at service level |
| 17 | 1 Downloads | Download with NO network | DEVICE-ONLY | `__tests__/unit/utils/downloadErrors.test.ts` (classifier) | Real radio off; error-copy classification unit-tested |
| 18 | 1 Downloads | Interrupted download recovers after relaunch | HAS-UI-TEST | `__tests__/integration/downloads/sttInterruptedRelaunch.rendered.redflow.test.tsx` | T004/T007/DEV-D1/V3; rendered. Real force-kill is device caveat |
| 19 | 1 Downloads | Truncated file not listed as ready | HAS-UI-TEST | `__tests__/integration/downloads/whisperTruncatedListed.rendered.redflow.test.tsx` | T006/DEV-V2; rendered size-floor filter |
| 20 | 1 Downloads | Kill mid-extraction recovers | HAS-UI-TEST | `__tests__/integration/downloads/imageExtractLostRelaunch.rendered.redflow.test.tsx` | T004/T108/DEV-D1/D2; rendered. Real kill timing is device caveat |
| 21 | 1 Downloads | Retry a failed image extraction | HAS-UI-TEST | `__tests__/rntl/components/CompletedDownloadCardRepair.test.tsx` | log-B6/D1; rendered retry affordance |
| 22 | 1 Downloads | Embedding model (first KB use) | HAS-UI-TEST | `__tests__/integration/knowledge-base/embeddingSidecarResident.rendered.happy.test.tsx` | Rendered embedding download/residency on KB use |

## Phase 2 Text gen

| # | Phase | What to test | Bucket | Existing test (if any) | Note |
|---|---|---|---|---|---|
| 23 | 2 Text gen | First message loads + replies (GGUF) | HAS-UI-TEST | `__tests__/integration/happy/firstMessage.happy.test.tsx` | T013; rendered lazy-load-on-send |
| 24 | 2 Text gen | First message replies (litert) | HAS-UI-TEST | `__tests__/integration/memory/litertLazyOnSelect.rendered.happy.test.tsx` | T017; rendered litert path |
| 25 | 2 Text gen | GPU/OpenCL backend | HAS-UI-TEST | `__tests__/integration/happy/gpuBackendMeta.rendered.happy.test.tsx` | T014; rendered Generation Details GPU layers |
| 26 | 2 Text gen | CPU backend (GGUF) | HAS-UI-TEST | `__tests__/integration/happy/gpuBackendMeta.rendered.happy.test.tsx` | T014 contrast; same rendered meta test |
| 27 | 2 Text gen | GPU init timeout falls back to CPU | HAS-UI-TEST | `__tests__/integration/happy/gpuInitTimeoutFallback.rendered.happy.test.tsx` | T016/DEV-B24; rendered fallback |
| 28 | 2 Text gen | GPU layers slider applies | HAS-UI-TEST | `__tests__/integration/happy/gpuBackendMeta.rendered.happy.test.tsx` | Rendered offload-count meta |
| 29 | 2 Text gen | litert CPU backend fails gracefully | HAS-UI-TEST | `__tests__/integration/generation/litertCpuInvokeError.rendered.redflow.test.tsx` | T018/DEV-B23; rendered. Real Status-13 native invoke is device caveat |
| 30 | 2 Text gen | NPU/HTP backend gated or graceful | DEVICE-ONLY | — | T015/DEV-B22; NPU gibberish is firmware, no JS gate |
| 31 | 2 Text gen | Temperature applies to a generation | HAS-UI-TEST | `__tests__/integration/happy/settingsApplied.happy.test.tsx` | Rendered: dragged temp reaches native resetConversation |
| 32 | 2 Text gen | Top-P applies | HAS-UI-TEST | `__tests__/integration/happy/settingsApplied.happy.test.tsx` | Rendered sampler-to-engine |
| 33 | 2 Text gen | Context length applies | HAS-UI-TEST | `__tests__/rntl/components/GenerationSettingsModal.test.tsx` | Rendered modal edits Context Length; e2e n_ctx not asserted |
| 34 | 2 Text gen | System prompt applies | NO-TEST | — | No behavioral test drives system-prompt-obeyed |
| 35 | 2 Text gen | CPU threads applies | HAS-UI-TEST | `__tests__/rntl/components/GenerationSettingsModal.test.tsx` | Rendered CPU Threads setting; applies-to-gen is device |
| 36 | 2 Text gen | Batch size applies | HAS-SERVICE-TEST-ONLY | `__tests__/unit/hooks/useTextGenerationAdvanced.test.ts` | n_batch at hook level; no UI mount |
| 37 | 2 Text gen | Flash attention toggle applies | DEVICE-ONLY | `__tests__/rntl/components/GenerationSettingsModal.test.tsx` (toggle renders) | Real effect on-device; toggle itself rendered |
| 38 | 2 Text gen | Plain reply has no stray think tags | HAS-UI-TEST | `__tests__/rntl/components/ChatMessage.test.tsx` (+ `parseModelOutput.contract.test.ts`) | T032/DEV-B6; rendered empty-think case + unit contract |
| 39 | 2 Text gen | Thinking renders in block mid-stream | HAS-UI-TEST | `__tests__/integration/generation/thinkingRendersInBlockMidStream.rendered.redflow.test.tsx` | T033/DEV-B14/B5; rendered |
| 40 | 2 Text gen | Thinking header reads "Thinking" streaming | HAS-UI-TEST | `__tests__/integration/generation/thinkingHeaderWhileStreaming.rendered.redflow.test.tsx` | T035/DEV-Q6; rendered header state |
| 41 | 2 Text gen | Long output cutoff indicator | HAS-UI-TEST | `__tests__/integration/generation/maxPredictSilentCutoff.rendered.redflow.test.tsx` | T034/DEV-B15; rendered cutoff indicator |
| 42 | 2 Text gen | Failed generation clears the spinner | HAS-UI-TEST | `__tests__/integration/generation/errorClearsSpinner.rendered.redflow.test.tsx` | T056/DEV-B13; rendered spinner-clears + error bubble |
| 43 | 2 Text gen | Stop mid-generation keeps partial | HAS-UI-TEST | `__tests__/rntl/screens/ChatScreen.test.tsx` (stop) + `__tests__/unit/screens/getDisplayMessages.test.ts` (partial) | T037; rendered stop button; partial-retention at store level |
| 44 | 2 Text gen | Queue while generating | HAS-SERVICE-TEST-ONLY | `__tests__/integration/generation/queuedSendFeedback.test.ts` | T036; queue subscription/count, no render() |
| 45 | 2 Text gen | Copy a message | HAS-UI-TEST | `__tests__/rntl/components/ChatMessage.test.tsx` | Rendered action-copy fires onCopy |
| 46 | 2 Text gen | Edit a user message and resend | HAS-UI-TEST | `__tests__/integration/happy/editMessage.happy.test.tsx` | Rendered long-press → Edit → resend, real regen |
| 47 | 2 Text gen | Regenerate a reply | HAS-UI-TEST | `__tests__/integration/happy/resend.happy.test.tsx` | Rendered long-press → Retry, real regenerate |
| 48 | 2 Text gen | Mid-conversation sampler change takes effect | HAS-SERVICE-TEST-ONLY | `__tests__/integration/generation/litertSamplerRedflow.test.ts` | T101/DEV-Q18; sampler re-apply at service level |
| 49 | 2 Text gen | Reset to Defaults (text params) | HAS-UI-TEST | `__tests__/rntl/components/GenerationSettingsModal.test.tsx` | Rendered reset press calls updateSettings defaults |
| 50 | 2 Text gen | Context-full new-chat prompt | HAS-UI-TEST | `__tests__/integration/projects/contextFullNewChatDropsProject.rendered.redflow.test.tsx` | Q11; rendered context-full alert + New chat flow |

## Phase 3 Voice

| # | Phase | What to test | Bucket | Existing test (if any) | Note |
|---|---|---|---|---|---|
| 51 | 3 Voice | Mic permission prompt on first record | DEVICE-ONLY | — | Real OS mic dialog; cannot fake |
| 52 | 3 Voice | Mic permission DENIED handled | HAS-SERVICE-TEST-ONLY | `__tests__/unit/hooks/useVoiceRecording.test.ts`, `__tests__/unit/services/audioRecorderService.test.ts` | Deny-path logic unit-tested; real deny dialog is device |
| 53 | 3 Voice | Chat-mode dictation to composer | HAS-UI-TEST | `__tests__/integration/audio/chatModeSttArchitecture.rendered.redflow.test.tsx` | T075/B26/B28; renders ChatScreen, transcript lands in input; native capture device caveat |
| 54 | 3 Voice | Chat-mode dictation on litert | HAS-UI-TEST | `__tests__/integration/audio/chatModeSttArchitecture.rendered.redflow.test.tsx` | B28; one-pipeline proof; real litert mic capture device caveat |
| 55 | 3 Voice | Voice note carries transcript (chat) | HAS-SERVICE-TEST-ONLY | `__tests__/integration/generation/voiceNoteTranscriptOnly.test.ts`, `__tests__/unit/components/voiceNoteSend.test.ts` | T076/Q20; transcript-not-audio invariant at service seam |
| 56 | 3 Voice | Voice note transcript on litert + tool | HAS-SERVICE-TEST-ONLY | `__tests__/integration/chat/voiceNoteToolAudio.redflow.test.ts`, `__tests__/integration/generation/engineParityRedflow.test.ts` | T059/Q17; redflow service test |
| 57 | 3 Voice | Mic stops cleanly on leave | HAS-UI-TEST | `__tests__/integration/audio/micNoStopLeakOnLeave.rendered.redflow.test.tsx` | T077/B11; rendered + navigate away; battery/privacy indicator device |
| 58 | 3 Voice | Double-tap mic no collision | HAS-UI-TEST | `__tests__/integration/audio/micDoubleTapRaceCollision.rendered.redflow.test.tsx` | T078/B12; rendered gesture race; native start-count device |
| 59 | 3 Voice | Voice-mode transcript renders | HAS-UI-TEST | `__tests__/integration/audio/chatModeSttArchitecture.rendered.redflow.test.tsx` | T079; file-transcribe path asserted in same rendered STT test |
| 60 | 3 Voice | Full voice-mode journey (STT→reply→TTS) | HAS-UI-TEST | `__tests__/integration/audio/voiceModeCalculatorJourney.rendered.happy.test.tsx`, `voiceModeImageJourney.rendered.happy.test.tsx` | 4-subsystem happy path rendered end-to-end |
| 61 | 3 Voice | Voice draw-request routes to image | HAS-UI-TEST | `__tests__/integration/audio/voiceModeImageJourney.rendered.happy.test.tsx` | T084; rendered voice→image routing |
| 62 | 3 Voice | Voice calculator journey | HAS-UI-TEST | `__tests__/integration/audio/voiceModeCalculatorJourney.rendered.happy.test.tsx` | T085; rendered STT→tool→TTS |
| 63 | 3 Voice | Voice-mode Stop button while generating | HAS-UI-TEST | `__tests__/integration/audio/voiceModeGeneratingStopButton.rendered.redflow.test.tsx` | T088/B29; rendered Stop-vs-mic state |
| 64 | 3 Voice | No stray empty bubble in voice tool turn | HAS-UI-TEST | `__tests__/integration/audio/voiceModeStrayEmptyBubble.rendered.redflow.test.tsx` | T087/B32; rendered phantom-bubble guard |
| 65 | 3 Voice | Voice thinking block width + alignment | HAS-UI-TEST | `__tests__/integration/audio/voiceModeThinkingBlockWidth.rendered.redflow.test.tsx` | T086/B27; rendered layout width assertion |

## Phase 4 Image / Vision

| # | Phase | What to test | Bucket | Existing test (if any) | Note |
|---|---|---|---|---|---|
| 66 | 4 Image | Image generates and renders | HAS-UI-TEST | `__tests__/integration/happy/imageModeToggle.happy.test.tsx`, `imageBackends.happy.test.tsx` | T061; renders ChatScreen, image + backend label |
| 67 | 4 Image | Image Size + Guidance honored | HAS-UI-TEST | `__tests__/integration/image/imageGenMeta.redflow.test.tsx` | T064/T065/Q13/Q7; rendered size+guidance |
| 68 | 4 Image | Image size floors at 256 | HAS-UI-TEST | `__tests__/integration/image/imageGenMeta.redflow.test.tsx` | T063/Q1; rendered guard 128→256 |
| 69 | 4 Image | Image steps applies | HAS-SERVICE-TEST-ONLY | `__tests__/unit/services/localDreamGenerator.test.ts`, `imageGenerator.test.ts` | Step count at generator service; no rendered assertion |
| 70 | 4 Image | Tap image opens fullscreen preview | HAS-UI-TEST | `__tests__/integration/happy/imageLightbox.happy.test.tsx` | T068; rendered tap→viewer, Close/Save |
| 71 | 4 Image | Tap attached (pre-send) image previews | HAS-UI-TEST | `__tests__/integration/chat/attachmentPreviewTap.rendered.redflow.test.tsx` | T057/B19; rendered pre-send thumbnail onPress |
| 72 | 4 Image | Non-draw prompt routes to text | HAS-UI-TEST | `__tests__/integration/happy/imageIntentRouting.happy.test.tsx` | T069; rendered routing control case |
| 73 | 4 Image | Resend of image request re-draws | HAS-UI-TEST | `__tests__/integration/generation/resendImageRoutes.rendered.redflow.test.tsx`, `resendImageRoutesLlama.rendered.redflow.test.tsx` | T062/B33; rendered resend re-routes to image |
| 74 | 4 Image | Reset to Defaults resets image params | HAS-UI-TEST | `__tests__/integration/settings/imageSettings.redflow.test.tsx` | T066/Q12; rendered reset |
| 75 | 4 Image | Chat-modal vs Model-Settings sliders agree | HAS-UI-TEST | `__tests__/integration/settings/imageSettings.redflow.test.tsx` | T067/Q13; rendered floor-agreement |
| 76 | 4 Image | First-gen warmup notice accurate | NO-TEST | — | T070/B21; cosmetic warmup estimate, no test |
| 77 | 4 Image | Generated images appear in Gallery | HAS-UI-TEST | `__tests__/rntl/screens/GalleryScreen.test.tsx` | Renders grid, viewer, delete/save modes |
| 78 | 4 Vision | Photo permission prompt on first attach | DEVICE-ONLY | — | Real OS photo dialog |
| 79 | 4 Vision | Photo permission DENIED handled | DEVICE-ONLY | — | Real OS deny dialog |
| 80 | 4 Vision | Vision answers about an image | HAS-UI-TEST | `__tests__/integration/happy/multimodalVision.happy.test.tsx` | T054; rendered attach-photo → answer |
| 81 | 4 Vision | Image + text in one turn | HAS-SERVICE-TEST-ONLY | `__tests__/hardening/batch3-visionSendGate.test.ts` | Mixed-modality prompt build at llmMessages seam; no rendered mixed-turn test |
| 82 | 4 Vision | Big vision model decode handled | NO-TEST | — | T055/B9; model-specific decode failure/spinner-clear not tested |
| 83 | 4 Vision | litert vision affordance consistent | HAS-UI-TEST | `__tests__/integration/vision/litertVisionAffordanceConsistent.guard.test.tsx` | T058/B20; guard.test.tsx renders + attach, asserts chip |
| 84 | 4 Vision | Non-vision model image refused gracefully | HAS-SERVICE-TEST-ONLY | `__tests__/hardening/batch3-visionSendGate.test.ts`, `__tests__/unit/services/generationServiceHelpers.branches.test.ts` | T060/Q17b; gate at service; native crash device |

## Phase 5 Memory

| # | Phase | What to test | Bucket | Existing test (if any) | Note |
|---|---|---|---|---|---|
| 85 | 5 Memory | Loading mode selectable + persists | HAS-UI-TEST | `__tests__/integration/memory/aggressiveDirtyOverCommit.rendered.redflow.test.tsx` | M1; renders ModelLoadingModeSelector, presses aggressive |
| 86 | 5 Memory | Whisper not resident on download | HAS-UI-TEST | `__tests__/integration/memory/whisperResidentOnDownload.rendered.redflow.test.tsx` | T022/B1; rendered In-Memory selector, whisper absent |
| 87 | 5 Memory | Conservative = one heavy at a time | HAS-SERVICE-TEST-ONLY | `__tests__/integration/memory/loadingModes.redflow.test.ts` | T026/M1; service redflow, real residency manager; no rendered variant |
| 88 | 5 Memory | Balanced = co-reside if they fit | HAS-SERVICE-TEST-ONLY | `__tests__/integration/memory/loadingModes.redflow.test.ts` | T026; service redflow co-reside branch |
| 89 | 5 Memory | Text + whisper co-reside (roomy) | HAS-UI-TEST | `__tests__/integration/memory/textWhisperCoresident.rendered.happy.test.tsx` | T116/M1; rendered In-Memory lists both |
| 90 | 5 Memory | Sidecars co-reside with a heavy | HAS-UI-TEST | `__tests__/integration/memory/ttsCoresidentInVoiceTurn.rendered.happy.test.tsx` | T120; rendered STT+TTS co-reside with text |
| 91 | 5 Memory | TTS co-resident in a voice turn | HAS-UI-TEST | `__tests__/integration/memory/ttsCoresidentInVoiceTurn.rendered.happy.test.tsx` | T120/V4/V5; rendered In-Memory lists tts |
| 92 | 5 Memory | Embedding sidecar resident on KB embed | HAS-UI-TEST | `__tests__/integration/knowledge-base/embeddingSidecarResident.rendered.happy.test.tsx` | T118; rendered embedding sidecar co-residence |
| 93 | 5 Memory | Idle STT reclaimed for a text turn | HAS-UI-TEST | `__tests__/integration/memory/sttReclaimedOnSend.rendered.happy.test.tsx` | T111/B1/B2; rendered, budget pinned tight, whisper drops |
| 94 | 5 Memory | Idle STT reclaimed in a voice turn | HAS-UI-TEST | `__tests__/integration/memory/voiceNoteReclaimsStt.rendered.happy.test.tsx` | T115/B1/B2; rendered voice twin, budget override |
| 95 | 5 Memory | Whisper blocked then freed then retried | HAS-UI-TEST | `__tests__/integration/memory/whisperBlockedFreeRetry.rendered.happy.test.tsx` | T119/B1; rendered tight-RAM sequence |
| 96 | 5 Memory | OS memory-warning evicts idle sidecars | HAS-UI-TEST | `__tests__/integration/memory/memoryWarningEvictsSidecars.rendered.happy.test.tsx` | T117; rendered memory-warning event; real jetsam device |
| 97 | 5 Memory | Aggressive loads bigger automatically | HAS-SERVICE-TEST-ONLY | `__tests__/integration/memory/loadingModes.redflow.test.ts` | T028; aggressive load branch at service |
| 98 | 5 Memory | Aggressive does not over-commit dirty | HAS-UI-TEST | `__tests__/integration/memory/aggressiveDirtyOverCommit.rendered.redflow.test.tsx` | T103/M6; rendered In-Memory + card; native SIGKILL device |
| 99 | 5 Memory | Oversized model shows graceful card | HAS-UI-TEST | `__tests__/integration/happy/imageOomCard.happy.test.tsx` | T024/B2/M2; renders ModelFailureCard + Load Anyway |
| 100 | 5 Memory | Estimators agree (no safe-then-refuse) | HAS-SERVICE-TEST-ONLY | `__tests__/integration/memory/imageEstimatorDivergence.redflow.test.ts` | T027/Q14; service-level estimator agreement |
| 101 | 5 Memory | Load Anyway always loads | DEVICE-ONLY | `__tests__/integration/memory/aggressiveDirtyOverCommit.rendered.redflow.test.tsx` (verdict only) | T024/DEV. Native jetsam/OOM survival is device; gate verdict UI-tested |
| 102 | 5 Memory | Survival floor blocks guaranteed OOM | DEVICE-ONLY | `__tests__/integration/memory/overrideFloor.redflow.test.ts` (verdict) | T028/DEV-M3/M4. iOS jetsam confirmation device; floor verdict service-tested |
| 103 | 5 Memory | Image→chat swap | HAS-SERVICE-TEST-ONLY | `__tests__/integration/memory/resendAfterImageGen.redflow.test.ts` | T025/DEV-M11. Residency co-reside at service altitude |
| 104 | 5 Memory | Switch active model mid-chat | HAS-UI-TEST | `__tests__/integration/memory/litertLazyOnSelect.rendered.happy.test.tsx` | Real ModelSelector select→active→lazy-load, In Memory assert |
| 105 | 5 Memory | Eject All frees everything | HAS-UI-TEST | `__tests__/integration/memory/ejectAllUnloadsEveryType.rendered.redflow.test.tsx` | T023/DEV-B1. Renders + asserts every type unloaded |
| 106 | 5 Memory | Eject one resident from In Memory | HAS-UI-TEST | `__tests__/integration/memory/modelSelectorEjectResident.rendered.redflow.test.tsx` | T112/DEV-B1. Selector eject targets one type, rendered |
| 107 | 5 Memory | Lazy reload after eject | HAS-UI-TEST | `__tests__/integration/memory/lazyReloadAfterEject.rendered.redflow.test.tsx` | T114/DEV-B1. Rendered eject-then-send reload |
| 108 | 5 Memory | In Memory shows loaded model RAM | HAS-UI-TEST | `__tests__/integration/memory/modelSelectorShowsLoadedRam.rendered.redflow.test.tsx` | T113/DEV. Rendered selector shows name + RAM |
| 109 | 5 Memory | Stale TTS pressure cleared on delete | HAS-SERVICE-TEST-ONLY | `__tests__/integration/audio/ttsDeleteResidencyStale.redflow.test.ts` | T030/DEV-V4. Real deleteModels + residency; asserts resident set, no render |
| 110 | 5 Memory | Delete mid-playback keeps audio | NO-TEST | — | T083/DEV-V5. No test drives delete-during-active-TTS canEvict veto |
| 111 | 5 Memory | Device info memory readout | HAS-UI-TEST | `__tests__/rntl/screens/DeviceInfoScreen.test.tsx` | Renders RAM/footprint/limit |

## Phase 6 KB / Projects

| # | Phase | What to test | Bucket | Existing test (if any) | Note |
|---|---|---|---|---|---|
| 112 | 6 KB/Projects | Create a project | HAS-UI-TEST | `__tests__/rntl/screens/ProjectsScreen.test.tsx` | Screen render + create flow |
| 113 | 6 KB/Projects | KB indexes a text PDF | HAS-UI-TEST | `__tests__/rntl/screens/KnowledgeBaseScreen.test.tsx` (+ `embeddingSidecarResident.rendered.happy.test.tsx`) | T009/DEV. Rendered add-doc calls real indexDocument |
| 114 | 6 KB/Projects | Preview a KB document | HAS-UI-TEST | `__tests__/rntl/screens/DocumentPreviewScreen.test.tsx` | Renders content |
| 115 | 6 KB/Projects | Scanned PDF clear message | HAS-UI-TEST | `__tests__/integration/knowledge-base/kbScannedPdfMessage.rendered.redflow.test.tsx` | T010/DEV. Rendered scanned-PDF message |
| 116 | 6 KB/Projects | >5MB file rejected | HAS-UI-TEST | `__tests__/integration/knowledge-base/kbFileSizeGuard.rendered.happy.test.tsx` | T011/DEV. Rendered size gate |
| 117 | 6 KB/Projects | Embedding failure aborts + retry | HAS-UI-TEST | `__tests__/integration/knowledge-base/kbIndexEmbedFailAbort.rendered.redflow.test.tsx` (+ `indexDocumentRollback.redflow.test.ts`) | T009/DEV. Rendered error card + retry |
| 118 | 6 KB/Projects | KB retrieval in a chat | HAS-SERVICE-TEST-ONLY | `__tests__/integration/knowledge-base/searchKnowledgeBaseRoundtrip.test.ts` (+ `rag/ragFlow.test.ts`) | T089/DEV. Round-trip at service level; no chat-screen render |
| 119 | 6 KB/Projects | New chat inherits the project | HAS-UI-TEST | `__tests__/integration/projects/newChatFilesPendingProject.rendered.guard.test.tsx` | T092/DEV-Q10. Rendered |
| 120 | 6 KB/Projects | Context-full new chat keeps project | HAS-UI-TEST | `__tests__/integration/projects/contextFullNewChatDropsProject.rendered.redflow.test.tsx` | T093/DEV-Q11. Rendered continuation inherits project |
| 121 | 6 KB/Projects | Edit a project | HAS-UI-TEST | `__tests__/rntl/screens/ProjectEditScreen.test.tsx` | Render + save |
| 122 | 6 KB/Projects | Delete project handles its chats | HAS-UI-TEST | `__tests__/integration/projects/deleteProjectOrphansChats.redflow.test.tsx` (+ `orphanChatInjectsKbTool.redflow.test.ts`) | T090/T091/DEV-Q9/Q9b. tsx renders; KB-tool removal service-tested |

## Phase 7 Tools

| # | Phase | What to test | Bucket | Existing test (if any) | Note |
|---|---|---|---|---|---|
| 123 | 7 Tools | Calculator tool runs | HAS-UI-TEST | `__tests__/integration/happy/tools.happy.test.tsx` | T043/DEV. Enable via real Tools screen, result bubble renders |
| 124 | 7 Tools | Datetime tool runs | NO-TEST | — | get_current_datetime only in unit registry/handlers; no rendered run |
| 125 | 7 Tools | Device info tool runs | NO-TEST | — | get_device_info only in unit handlers; no rendered run |
| 126 | 7 Tools | Web search tool runs | NO-TEST | — | web_search unit handlers + ToolsScreen list only; no rendered run |
| 127 | 7 Tools | Parallel tool calls | HAS-UI-TEST | `__tests__/integration/happy/tools.happy.test.tsx` (T044 case) | T044/DEV. Two calculator bubbles rendered |
| 128 | 7 Tools | Thinking + tool + answer in order | HAS-UI-TEST | `__tests__/integration/chat/thinkingToolAnswerRender.rendered.happy.test.tsx` | T038/DEV. Ordered render asserted |
| 129 | 7 Tools | Messy tool JSON still runs | HAS-UI-TEST | `__tests__/integration/chat/toolMessyJson.rendered.redflow.test.tsx` | T039/DEV-Q2. Rendered tolerant parse |
| 130 | 7 Tools | Stringified tool args parsed | HAS-UI-TEST | `__tests__/integration/chat/toolStringifiedArgs.rendered.redflow.test.tsx` | T040/DEV-Q3. Rendered |
| 131 | 7 Tools | Tool router no false positive | HAS-SERVICE-TEST-ONLY | `__tests__/integration/chat/toolRouterFalsePositive.redflow.test.ts` | T041/DEV-Q4. Service-level only |
| 132 | 7 Tools | Empty final turn keeps tool data | HAS-UI-TEST | `__tests__/integration/chat/toolEmptyFinal.redflow.test.tsx` | T042/DEV-Q5. tsx renders ChatScreen |
| 133 | 7 Tools | Add / connect an MCP server | HAS-UI-TEST | `__tests__/rntl/components/McpServersScreen.test.tsx` (+ `McpAddServerSheet.test.tsx`) | Pro. Renders connecting/connected; live connect device |
| 134 | 7 Tools | MCP server tools listed | HAS-UI-TEST | `__tests__/pro/ui/McpToolsScreen.test.tsx` | Pro. Lists per-server tools + toggles |
| 135 | 7 Tools | Execute an MCP tool | HAS-UI-TEST | `__tests__/integration/happy/tools.happy.test.tsx` (MCP case) | Pro. Registered MCP tool executes, result in rendered ChatScreen |
| 136 | 7 Tools | MCP tool error handled | HAS-SERVICE-TEST-ONLY | `__tests__/pro/mcp/McpToolExtension.extra.test.ts` | Pro. execute() never-throws at service level; no rendered stuck-spinner assert |
| 137 | 7 Tools | MCP guide screen renders | HAS-UI-TEST | `__tests__/pro/ui/McpGuideScreen.test.tsx` | Pro. Guide screen renders |

## Phase 8 Remote

| # | Phase | What to test | Bucket | Existing test (if any) | Note |
|---|---|---|---|---|---|
| 138 | 8 Remote | Remote model replies | HAS-UI-TEST | `__tests__/integration/generation/remoteServerConnect.rendered.happy.test.tsx` | T046/DEV. Rendered add-server → Connected via faked harness |
| 139 | 8 Remote | No phantom servers on empty scan | HAS-UI-TEST | `__tests__/integration/generation/scanNoServersNoPhantom.rendered.happy.test.tsx` | T047/DEV-B8. Rendered; alert + empty list agree |
| 140 | 8 Remote | Remote model visible indicator | HAS-UI-TEST | `__tests__/integration/generation/remoteModelIndicator.rendered.happy.test.tsx` | T053/DEV. Rendered wifi header + Remote badge |
| 141 | 8 Remote | Remote reasoning renders (Ollama) | HAS-UI-TEST | `__tests__/integration/generation/remoteOllamaReasoningRenders.rendered.redflow.test.tsx` | T051/DEV. Rendered thinking + tool bubbles |
| 142 | 8 Remote | Remote reasoning renders (LM Studio) | HAS-UI-TEST | `__tests__/integration/generation/remoteReasoningDropped.rendered.redflow.test.tsx` | T049/T050/DEV-B16/B17. Rendered reasoning_content not dropped |
| 143 | 8 Remote | Remote parallel tool calls | HAS-UI-TEST | `__tests__/integration/generation/remoteParallelTools.rendered.happy.test.tsx` | T048/DEV. Rendered accumulate-by-index bubbles |
| 144 | 8 Remote | Remote prompt-enhance runs | HAS-SERVICE-TEST-ONLY | `__tests__/integration/chat/remoteEnhanceSkipped.redflow.test.ts` | T052/DEV-Q8/B30. Enhance-via-remote at service level, no render |
| 145 | 8 Remote | Remote server dies mid-generation | DEVICE-ONLY | `__tests__/integration/generation/remoteFailureClearsLoading.test.ts` (partial) | Real mid-stream kill device; HTTP-400 loading-clear invariant service-tested |
| 146 | 8 Remote | Remote request timeout | NO-TEST | — | No remote-generation timeout test |
| 147 | 8 Remote | Malformed remote response handled | NO-TEST | — | No test feeds non-JSON/malformed SSE into remote gen |
| 148 | 8 Remote | Local select makes model active | HAS-SERVICE-TEST-ONLY | `__tests__/integration/generation/unifiedModelSelection.test.ts` | T098/DEV-B18. Service-level clear-remote-on-local-select; no rendered new-send assert |
| 149 | 8 Remote | Home Text count truthful w/ remote active | HAS-UI-TEST | `__tests__/integration/generation/remoteModelIndicator.rendered.happy.test.tsx` (+ `home/homeRemoteModelTextCount.rendered.happy.test.tsx`) | T097/DEV. Rendered remote-indicator/count on Home |

## Phase 9 Enhancement

| # | Phase | What to test | Bucket | Existing test (if any) | Note |
|---|---|---|---|---|---|
| 150 | 9 Enhancement | Enhancement request carries no thinking | HAS-UI-TEST | `__tests__/integration/generation/enhancementNoThinking.rendered.redflow.test.tsx` | T071/DEV-B30. Rendered, no reasoning markers |
| 151 | 9 Enhancement | Enhanced prompt is clean rewrite | HAS-UI-TEST | `__tests__/integration/generation/enhancementReasoningPrompt.rendered.redflow.test.tsx` | T072/DEV-B30. Rendered outcome-check |
| 152 | 9 Enhancement | Enhancement shows progress | HAS-UI-TEST | `__tests__/integration/generation/enhancementStreamingProgress.rendered.redflow.test.tsx` | T073/DEV-B30b. Rendered streaming-progress indicator |
| 153 | 9 Enhancement | Enhancement rewrites then regenerates | HAS-SERVICE-TEST-ONLY | `__tests__/integration/happy/promptEnhancement.happy.test.tsx` | T074/DEV. Store-level, no render |

## Phase 10 TTS

| # | Phase | What to test | Bucket | Existing test (if any) | Note |
|---|---|---|---|---|---|
| 154 | 10 TTS | Speak a reply (no Speak on user msgs) | HAS-UI-TEST | `__tests__/integration/happy/speakMessage.happy.test.tsx` | T081/DEV. Real ChatScreen + ActionMenu gesture; canSpeak gate |
| 155 | 10 TTS | TTS text is markdown-stripped | HAS-UI-TEST | `__tests__/integration/chat/speakMarkdown.redflow.test.tsx` | T082/DEV-Q19. Renders MessageRenderer, asserts speak-slot text |

## Phase 11 Polish

| # | Phase | What to test | Bucket | Existing test (if any) | Note |
|---|---|---|---|---|---|
| 156 | 11 Polish | Theme switch applies | HAS-UI-TEST | `__tests__/rntl/screens/SettingsScreen.test.tsx` | Renders Appearance selector → setThemeMode |
| 157 | 11 Polish | Empty state: no models | HAS-UI-TEST | `__tests__/rntl/components/ModelSelectorModal.test.tsx` (+ `NoModelScreen.test.tsx`) | Renders "No Text Models" empty state |
| 158 | 11 Polish | Empty state: no chats | HAS-UI-TEST | `__tests__/rntl/screens/ChatsListScreen.test.tsx` | describe('empty state') rendered |
| 159 | 11 Polish | Empty state: no KB docs | HAS-UI-TEST | `__tests__/rntl/screens/KnowledgeBaseScreen.test.tsx` | Renders "No documents yet" |
| 160 | 11 Polish | Long-text wrapping | HAS-UI-TEST | `__tests__/rntl/components/MarkdownText.test.tsx` | Renders markdown/code; no explicit overflow assert |
| 161 | 11 Polish | Orientation behavior | DEVICE-ONLY | — | Real rotation / Info.plist portrait-lock |
| 162 | 11 Polish | About screen renders | HAS-UI-TEST | `__tests__/rntl/screens/AboutScreen.test.tsx` | Renders links; real open device |
| 163 | 11 Polish | Storage usage screen | HAS-UI-TEST | `__tests__/rntl/screens/StorageSettingsScreen.test.tsx` | Renders storage/model sizes, orphaned files, clear-cache |
| 164 | 11 Polish | App lock passphrase set + enforce | HAS-UI-TEST | `__tests__/rntl/screens/LockScreen.test.tsx`, `SecuritySettingsScreen.test.tsx`, `PassphraseSetupScreen.test.tsx` | Rendered lock/setup; verify/unlock/reject. Biometric device |
| 165 | 11 Polish | Share/promo sheet once per session | HAS-UI-TEST | `__tests__/integration/happy/supportShareDismiss.happy.test.tsx` (+ `home/sharePromptOncePerSession.rendered.test.tsx`) | T096/DEV. Rendered once-per-session guard |
| 166 | 11 Polish | Settings persist across relaunch | HAS-UI-TEST | `__tests__/integration/happy/persistence.happy.test.tsx` (+ `settingsApplied.happy.test.tsx`) | Persistence gate. Real persist+relaunch; project round-trip, not every setting individually |
| 167 | 11 Polish | Chat history survives relaunch | HAS-SERVICE-TEST-ONLY | `__tests__/integration/happy/persistence.happy.test.tsx` | Persistence renders project round-trip only; chat-history relaunch = store rehydration |
| 168 | 11 Polish | Downloaded models survive relaunch | NO-TEST | — | No per-entity relaunch test for downloaded-models list |
| 169 | 11 Polish | Active model selection survives relaunch | NO-TEST | — | No relaunch test asserting active-model persists |
| 170 | 11 Polish | Projects + KB survive relaunch | HAS-UI-TEST | `__tests__/integration/happy/persistence.happy.test.tsx` | Real form-create project → relaunch → renders (KB/index persistence not separately asserted) |
| 171 | 11 Polish | Download entries survive relaunch | NO-TEST | — | DEV. No relaunch test for Download Manager entry restore/retriable |
| 172 | 11 Polish | Background → foreground mid-gen | DEVICE-ONLY | — | Real OS bg/fg transition |
| 173 | 11 Polish | Kill mid-generation recovers | DEVICE-ONLY | — | On-kill / jetsam |
| 174 | 11 Polish | Airplane mode local-only works | DEVICE-ONLY | — | Real radio off |
| 175 | 11 Polish | Thermal / long-context stress | DEVICE-ONLY | — | DEV-B31. Thermal, observational not a gate |
| 176 | 11 Polish | Stay-in-the-loop card placement | NO-TEST | — | No test asserts card ordering in Settings community area |
| 177 | 11 Polish | Follow on X opens profile | DEVICE-ONLY | — | FOLLOW_X_URL external link open |
| 178 | 11 Polish | Join Slack opens invite | DEVICE-ONLY | — | SLACK_INVITE_URL external link |
| 179 | 11 Polish | Share on X prefilled | HAS-UI-TEST | `__tests__/rntl/screens/AboutScreen.test.tsx` (+ `SharePromptSheet.test.tsx`) | shareOnX(). Rendered hands OS the correct URL; real browser open device |

## Phase 12 This-release

| # | Phase | What to test | Bucket | Existing test (if any) | Note |
|---|---|---|---|---|---|
| 180 | 12 This-release | Gemma-4 native-first thinking + tool | DEVICE-ONLY | `__tests__/integration/chat/thinkingToolAnswerRender.rendered.happy.test.tsx` (parity only) | GAPS:204. Render order proven; native-first [GEMMA-FALLBACK] log check is device release blocker |
| 181 | 12 This-release | Upgrade-over-install keeps data + loading mode | DEVICE-ONLY | — | loadPolicySync migration; device release blocker (own pass) |
| 182 | 12 This-release | Parse-once think+tool+answer on litert | HAS-UI-TEST | `__tests__/integration/chat/thinkingToolAnswerRender.rendered.happy.test.tsx` (+ `engineParityRedflow.test.ts`) | T038. Rendered litert reason→tool→answer in order |
| 183 | 12 This-release | Parse-once think+tool+answer on remote | HAS-UI-TEST | `__tests__/integration/generation/remoteOllamaReasoningRenders.rendered.redflow.test.tsx` (+ `remoteParallelTools.rendered.happy.test.tsx`) | T051/T048. Rendered remote thinking + tool + answer |
| 184 | 12 This-release | Remote activation frees local heavy | HAS-SERVICE-TEST-ONLY | `__tests__/integration/happy/residencySwap.happy.test.ts` | Residency accounting via getResidents(); no render / no In Memory UI assert |
| 185 | 12 This-release | Mid-chat model switch stays coherent | HAS-SERVICE-TEST-ONLY | `__tests__/integration/models/chatHomeSelectorParity.test.ts` (+ `activeModelService.test.ts`) | GAPS:180. Service decision; no render, no send-again coherence at UI |
| 186 | 12 This-release | Remote stream interruption recovers | DEVICE-ONLY | `__tests__/integration/generation/errorClearsSpinner.rendered.redflow.test.tsx` (partial) | Real WiFi kill device; spinner-clear/error-surface partly covered |

---

## SUMMARY

### Counts per bucket per phase

| Phase | HAS-UI-TEST | HAS-SERVICE-TEST-ONLY | NO-TEST | DEVICE-ONLY | Total |
|---|---|---|---|---|---|
| 0 Install | 2 | 0 | 0 | 1 | 3 |
| 1 Downloads | 10 | 6 | 1 | 2 | 19 |
| 2 Text gen | 20 | 3 | 1 | 2 | 26 |
| 3 Voice | 11 | 3 | 0 | 1 | 15 |
| 4 Image/Vision | 11 | 3 | 2 | 2 | 18 |
| 5 Memory | 15 | 5 | 1 | 2 | 23 |
| 6 KB/Projects | 10 | 1 | 0 | 0 | 11 |
| 7 Tools | 8 | 2 | 3 | 0 | 13 |
| 8 Remote | 6 | 2 | 2 | 1 | 11 |
| 9 Enhancement | 3 | 1 | 0 | 0 | 4 |
| 10 TTS | 2 | 0 | 0 | 0 | 2 |
| 11 Polish | 10 | 1 | 4 | 8 | 23 |
| 12 This-release | 2 | 2 | 0 | 3 | 7 |
| **TOTAL** | **110** | **29** | **14** | **24** | **186** |

### GAP LIST — buildable UI-behavior test gaps

Rows that are **NO-TEST** or **HAS-SERVICE-TEST-ONLY** and are **NOT device-only**. These are what
the next pass should turn into UI-behavior integration tests (or, where a service test already
proves the logic, add a rendered variant that drives it through the screen).

**Phase 1 Downloads**
- 7 — Vision model (mmproj) download (service-only)
- 10 — Second whisper model download (service-only)
- 11 — TTS (Kokoro) model download (service-only)
- 12 — Image model download extraction-gated (service-only)
- 13 — Large text model download (service-only)
- 14 — litert model download (NO-TEST)
- 16 — Concurrent / queued downloads (service-only)

**Phase 2 Text gen**
- 34 — System prompt applies (NO-TEST)
- 36 — Batch size applies (service-only)
- 44 — Queue while generating (service-only)
- 48 — Mid-conversation sampler change takes effect (service-only)

**Phase 3 Voice**
- 55 — Voice note carries transcript, chat mode (service-only)
- 56 — Voice note transcript on litert + tool (service-only)

**Phase 4 Image/Vision**
- 69 — Image steps applies (service-only)
- 76 — First-gen warmup notice accurate (NO-TEST)
- 81 — Image + text in one turn (service-only)
- 82 — Big vision model decode handled (NO-TEST)
- 84 — Non-vision model image refused gracefully (service-only)

**Phase 5 Memory**
- 87 — Conservative = one heavy at a time (service-only)
- 88 — Balanced = co-reside if they fit (service-only)
- 97 — Aggressive loads bigger automatically (service-only)
- 100 — Estimators agree, no safe-then-refuse (service-only)
- 103 — Image→chat swap (service-only)
- 109 — Stale TTS pressure cleared on delete (service-only)
- 110 — Delete mid-playback keeps audio (NO-TEST)

**Phase 6 KB/Projects**
- 118 — KB retrieval in a chat (service-only)

**Phase 7 Tools**
- 124 — Datetime tool runs (NO-TEST)
- 125 — Device info tool runs (NO-TEST)
- 126 — Web search tool runs (NO-TEST)
- 131 — Tool router no false positive (service-only)
- 136 — MCP tool error handled (service-only)

**Phase 8 Remote**
- 144 — Remote prompt-enhance runs (service-only)
- 146 — Remote request timeout (NO-TEST)
- 147 — Malformed remote response handled (NO-TEST)
- 148 — Local select makes model active (service-only)

**Phase 9 Enhancement**
- 153 — Enhancement rewrites then regenerates (service-only)

**Phase 11 Polish**
- 167 — Chat history survives relaunch (service-only)
- 168 — Downloaded models survive relaunch (NO-TEST)
- 169 — Active model selection survives relaunch (NO-TEST)
- 171 — Download entries survive relaunch (NO-TEST)
- 176 — Stay-in-the-loop card placement (NO-TEST)

**Phase 12 This-release**
- 184 — Remote activation frees local heavy (service-only)
- 185 — Mid-chat model switch stays coherent (service-only)

**Total buildable gaps: 43** (14 NO-TEST + 29 HAS-SERVICE-TEST-ONLY).
