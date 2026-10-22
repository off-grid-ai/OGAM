# Release delta: v0.0.111 (last stable) → release/stable-v55-v115

Working list for the stable release decision. Updated 2026-10-22 15:15 IST.

- **Rendered** = a jest test that mounts the real screen, uses real gestures, fakes only at the device boundary.
- **Device** = a scripted journey on a real phone (`npm run e2e:journeys`). "old build" = iOS build 0.0.116 at `5f020e099`, before Reanimated 4.3 and the crash fixes.
- **Verdict:** SHIP = covered enough to roll out. NEEDS-E2E = no blocker known, but a device run must pass first. BLOCKER = known defect, must be fixed first.

## Blockers

| Change | Problem | Owner | Status |
|---|---|---|---|
| Model picker A→B→A (`TextTab.tsx:236`) | Tapping the resident model is disabled, so the selection and the loaded model disagree; vision is refused after 0.8B→2B→0.8B. Found on iOS (old build). | UAT session | Fixed in bcd2815f2 (pushed); device check = D3 |
| Engine capabilities (`engines.ts`) | Reported by the uat session. | uat session | Fixed in fd73fdfbb (pushed); device check = D3 |

## Needs a device run before release

| Change | Commits | Rendered | Android | iOS | Verdict |
|---|---|---|---|---|---|
| llama.rn 0.13.0-rc.7 (llama.cpp b11385, HTP kernels) | b99b7024a | engine faked | not run | thinking chat + vision PASS (old build) | NEEDS-E2E (Android) |
| LiteRT-LM 0.18.0 → 0.18.1, LiteRT GPU cache + CPU fallback | c55dd1d72, 3ad24e535, 0b13ebc28, c6052f5c0, fd80b6b76 | engine faked | not run | n/a | NEEDS-E2E (Android) |
| Production crash fixes (whisper lane, llama unload, MTP/draft GGUF refusal, TCP guard, clipboard, download ANR, sandbox, foreground service, JS crash frames, loading dots) | crash-fix branch, 10 commits | unit tests | pending (crash smoke) | PASS on fd73fdfbb (uat session): Stop <3 s; eject mid-reply stops + unloads, same PID; voice ×4 transcribes, same PID; TCP guard survives 150 resets; Chats fling fine. Not checked: downloads (Android-only fixes), CoreML disk-full | NEEDS-E2E (Android) |
| Reanimated 4.3.4 | 3b76f2451 | n/a | not run | not run on current build | NEEDS-E2E (both) |
| Android list clipping (LIST_CLIPPING_PROPS, 13 screens + pro) | 51b3175ef, d017ea879 | lint rule | not run | n/a | NEEDS-E2E (Android) |
| CoreML disk-space guard | b52d88c6b | — | n/a | not run | NEEDS-E2E (iOS) |
| Mic permission read without prompting | ed6f10b5 | PASS (iOS + Android) | not run | PASS 5/5 on fd73fdfbb | NEEDS-E2E (Android) |
| llama.rn vision after a model switch (picker fix on device) | bcd2815f2, fd73fdfbb | PASS | not run | PASS on fd73fdfbb (0.8B→2B→0.8B, photo answered) | NEEDS-E2E (Android) |
| Stop before a remote request is sent | 2ec0c1019 | PASS (OpenAI + Ollama) | not run | SKIP: no remote server on phone | SHIP (JS-only, rendered) |
| New Chat during a slow history load | a442af5f6 | PASS | not run | cold-launch New Chat PASS (old build) | NEEDS-E2E (Android) |
| Maker filters list curated models | 0f26712c0 | PASS | not run | PASS (old build) | SHIP |
| Check for new models: "Up to date" when unchanged | 03ce548de + shared#65 | PASS | not run | PASS (old build) | SHIP |

### Moved from SHIP to NEEDS-DEVICE (they change native or device behaviour; rendered tests fake that boundary)

| # | Change | Commits | Device check | Android | iOS |
|---|---|---|---|---|---|
| D1 | Load params (mmap, auto batch, KV prefix cache by free RAM) + auto threads | 0960f1ac6, 44627bd6e, d2b8b2113 | Qwen3.5 2B, 3 turns, tok/s, no crash/OOM; Android also on NPU/HTP (Qwen only) | pending | pending |
| D2 | KV state save/restore | f71c97f5f | chat A → chat B → background → A, reply keeps context | pending | pending |
| D3 | Residency policy + switch fit + picker fix | 04845bd1d, caad38a09, 654bc18d3, bcd2815f2, fd73fdfbb | 0.8B → 2B → 0.8B, send each time, photo on 0.8B works | pending | A→B→A→photo PASS on fd73fdfbb (uat session) |
| D4 | Device picks + Chat now (+ free space) | e81ab7406, 2c7a9e65c, 8ecdf0968 | real download, cancel, restart, finish, Chat now | pending | pending |
| D5 | Check for new models | 4f856566d, 5718352ca | once per platform | pending | PASS (old build) |
| D6 | Image generation (+ CoreML disk guard) | 4243833b9 | one image per platform | pending | pending |
| D7 | Live transcription (whisper.rn 0.5.5) | db25399be | one dictation in chat | pending | pending |

## Known issue, not a blocker

| Change | Problem | Verdict |
|---|---|---|
| "Download <model>" labels (9354460b1) | Labels are right, but on iOS the buttons inside model-detail file cards and Speech cards are not reachable as their own VoiceOver elements (nested in the card's button). Picks row is fine. Same as before this release. | SHIP; fix next |
| Chats list search row on scroll | Cards slide under the search row with no separation. Fix in progress (UI agent, simulator-verified). | SHIP; fix lands if ready |

## Covered by rendered tests (SHIP)

### v0.0.112
| Change | Commits | Rendered test |
|---|---|---|
| Saved key sent on every check; refused key reported; /v1 address; LAN HTTP with key | 73b1b890, 375da8f0, 16479c4d, 256c2735, 41313a47b | `remote/remoteServerSavedKey`, `privateHttpSavedKey`, `serverAddressWithV1Suffix` |
| Keyed server refusing discovery keeps saved models | 354f7a94 | `remote/keyedServerRefusedDiscoveryKeepsModels` |
| Keyless private-LAN HTTP discovered | 8964bc62 | `remote/keylessPrivateHttpDiscovered` |
| Failed key read / LM Studio probe refusal | 0576bf46, 05c2e43d | `remote/remoteServerSavedKey` |
| Web search 4xx/5xx and refusals are failures | 8707dc71, 9022536d | `chat/webSearchProviderFailure` |
| Remote JPEG/WebP deletable; deleted with their chat | fe810da7, 08dda04f | `image/remoteImageFormats`, `chats/chatDeleteRemoteImages` |

### v0.0.113 / v0.0.114
| Change | Commits | Rendered test |
|---|---|---|
| Image cancel and transfer races (cancel before start, cancel stops transfer, failed transfer leaves no file, result for deleted chat not saved, cancelled never touches next) | 366ff184, 5962357b, cce8e478, ef7a0265, 88232711 | `image/remoteImageTransfer`, `image/cancelledImageDoesNotOverlapNext`, `chats/deleteChatDuringImageGeneration` |
| Desktop image job cancelled on Stop | 53596925, 0ce79962 | `image/desktopImageStopCancelsJob` |
| Stop during prompt enhancement | d666287a, 7b32a90a | `image/stopDuringPromptEnhancement` |
| Chat delete cleans images (Home, project, open chat), says when it could not | c090e18c, 1e99a2ad, 55b6a9c2, 84d7f81f | `chats/chatDeleteImageFailure`, `chatScreenDeleteImageFailure`, `releaseCandidateE` M5 |
| Desktop not-enough-memory prompt | 218b4896 | `generation/remoteImageMemoryOverride` |
| MCP routing, owner, empty states | 7128f923, c9a7141b, 6b912def | `pro/mcpSameNameToolRouting`, `mcpToolOwnerLost`, `mcpToolsEmptyStates` |
| Voice: files checked on reply menu, Android denial remembered, transcript stays in its chat, voice downloads counted | af228b9d, ef4c5819, 56ea44ca, 1105f42a | `releaseCandidateE` M14/M16, `audio/voiceTranscriptStaysInItsChat`, `voiceDownloadManagerRouting` |
| Mic button shows access off | bbdb2647 | `audio/micPermissionDenied` |
| Vision projector repair | 365036dc, a08ac685 | `downloads/visionProjectorInitFailureRepairable` |
| Model names (catalog name, no Desktop path), image model stays on Image tab | 99a41394, fbc6c6de, a0dc4baa | `models/catalogGgufDisplayName`, `desktopModelNameNoPath`, `imageModelStaysListedAfterDownload` |
| Gallery synced images, Get Pro link, theme colours, a11y of alerts/dropdowns/tool switches, thinking preview | 4b8dc6db, cd28efe0, 609de834, 382a25db, 268d3c14, b93edc3d, 51740090 | `releaseCandidateE`, `rntl/*` |
| Assistant shape + helmet icon | 4c992067, cd15feac | `pro/assistantToggleHelmetShape` |
| Sponsoring phone keeps licence when pairing | 02ef21ea | `licensing/sponsorPairsIntoFullMesh` |
| Demo data (dev only) | f1a4a834, 0148f1f7, 82fc2ea9 | `settings/devToolingReleaseGate`, `demoSeedEmailDraftScenes` |

### v0.0.115
| Change | Commits | Rendered test |
|---|---|---|
| Queue: send now, remove, Stop holds the rest; one turn at a time | 4f539f3cd, efd842525, 1151a103d | `generation/queueSendNow`, `queueStoppedReplySettlesTwice` (outcome only) |
| Versions on retry/resend/edit; plain chat; relaunch | b7259d1d0, fc92a5785 | `happy/responseVersions`, `chatHistoryRelaunch`, `plainChatThenRetryRelaunch` |
| History kept after failed/slow load; stores keep session changes | 78bfd2290, 3c3ac5dce, 664bf0787, 84bdbe012 | `happy/chatHistoryLoadFailure`, `projectsAfterFailedLoad`, `chatHydrationResumesAfterSlowRead` |
| Knowledge: searched when needed, shared document engine, scanned PDF message, BLOB vectors | ba6bbd1a4, 5c12cc2fe, e6d8a2878, 944555dc0, 040867359 | `knowledge-base/*` |
| MCP tool on after relaunch; sign-in state | 938b958a9 | `pro/mcpToolChoiceRelaunch`, `mcpToolsWaitingForSignIn` |
| Shared residency policy | 04845bd1d | `memory/sharedResidencyPolicy` |
| Sync reconnect message dropped | 0db0f8a51 | `pro/sync/KnownDevicesSection` |

### v0.0.116
| Change | Commits | Rendered test |
|---|---|---|
| Fast/Balanced/Best picks (Text, Image, Speech), Chat now, sizes in words, catalog-first search | e81ab7406 … c549b3be6 | `models/devicePicks` |
| Check for new models sheet | 4f856566d … | `models/checkForNewModels` |
| Search hides too-big / newer-engine / image generators; HF uploads needing newer engine | c8a59c92a, 17191114a, 083c5a979, 024ea079f | `models/searchHidesUnrunnableModels`, `searchHidesUploadsNeedingNewerEngine` |
| Model card labels, plain cards, Tight files, Q4_0 on Android, curated names | 3f244d2e5, 15c24d837, 6f44c9f00, f6d9bec5f, c65001a69 | `models/modelCardReplacedAndResearchLicence`, `modelCardPlainWords`, `detailFilesFitHintUsesOwnedBudget`, `preferredQuantOrder`, `catalogGgufDisplayName` |
| Detail alerts once; recommended details failing; speech card order | 8ed3d2131, 7ed69c4b0, a65bff2de | `models/detailAlertsShowOnce`, `recommendedDetailsFailKeepCatalogFacts`, `speechCardsKeepTheirPlace` |
| MTP head download + retry | dc9c72f11, 19d75efc5 | `chat/mtpHeadDownloadRetry` |
| Place in chat kept (KV session) | f71c97f5f | `chat/kvSessionOnChatSwitch` (section) |
| Use fastest settings; threads/batch Auto | 2722a73d2, bc0e4adaf, 44627bd6e | `settings/useFastestSettings`, `threadsBatchAutoReset`, `loadParamsPerDevice` |
| Too-big switch keeps current model; LiteRT switch loads picked; cancel Insufficient Memory | 654bc18d3, 0e008461b, c9efac8a2 | `memory/llamaSwitchTooBigKeepsLoadedModel`, `litert/litertSwitchLoadsPickedModel`, `memory/cancelInsufficientMemoryKeepsLoadedModel` |
| Free space at download start, also queued; refusal pop-up shown | 8ecdf0968, 7cc903c2e, 2cd0608b9 | `downloads/downloadRefusedWhenLowOnSpace`, `queuedDownloadRefusedWhenSpaceDropped`, `finishedAndRefusedPopupsBothShown` |
| Setup never repeats a model across plans | d39d58b43 | `onboarding/autoSetupPlansDistinctChatModels` |
| Expired Pro: Back goes home | 93af64970 | `pro/proExpiryBackLeavesPaywall` |

## Not coverable by a UI test (logged in `docs/GAPS_BACKLOG.md`)
- Remote 4096 context (`9ea2c8275`): nothing reads the value. Unit test only. SHIP.
- "Research licence" label: no shipped model shows it. SHIP.
- Beta newer-engine warning: release script only. SHIP.

## Device journeys on the current build
- **Android (505b53a0):** not run yet on the current build. Queue: engine smoke (GGUF thinking, LiteRT, vision, Stop, vision after switch), mic permission, download labels, branch fixes, crash-fix smoke.
- **iOS (4CF4A291):** only the old build ran (results above). Lent to the uat session for crash-fix checks now. Rerun the journeys on the current build after it is handed back.
