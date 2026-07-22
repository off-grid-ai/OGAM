# OffgridMobile — Comprehensive Codebase & Product Flows Guide

This document provides an in-depth reference for the OffgridMobile application: its architecture, every major subsystem, data models, native integrations, and detailed product flows.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Architecture & Technology Stack](#2-architecture--technology-stack)
3. [Directory Structure](#3-directory-structure)
4. [Navigation & Screen Map](#4-navigation--screen-map)
5. [State Management (Zustand Stores)](#5-state-management-zustand-stores)
6. [Data Models & Types](#6-data-models--types)
7. [Core Services](#7-core-services)
8. [Native Integration Layer](#8-native-integration-layer)
9. [Product Flows — Detailed](#9-product-flows--detailed)
10. [Testing Infrastructure](#10-testing-infrastructure)
11. [Constants & Configuration](#11-constants--configuration)
12. [File System Layout (On-Device)](#12-file-system-layout-on-device)
13. [Appendix: Default System Prompt](#appendix-default-system-prompt)
14. [Appendix: Default Projects](#appendix-default-projects)

---

## 1. Product Overview

OffgridMobile is a **privacy-first, on-device AI assistant** built with React Native. It runs large language models (LLMs), Stable Diffusion image generators, and Whisper speech-to-text models entirely on the user's phone — no server, no internet required after initial model download.

**Core capabilities:**
- Text chat with streaming LLM inference (llama.cpp via `llama.rn`)
- Remote LLM server support (connect to Ollama, LM Studio, LocalAI, or any OpenAI-compatible server on the local network)
- Tool calling with automatic tool loop (web search, URL reader, calculator, date/time, device info, knowledge base search)
- Project-scoped RAG knowledge base (upload documents, embed on-device with MiniLM, retrieve via cosine similarity)
- Image generation with Stable Diffusion (MNN/QNN backends via LocalDream)
- Voice input via Whisper speech-to-text (whisper.cpp via `whisper.rn`)
- Vision model support (multimodal LLMs with image understanding)
- Document attachment and analysis
- Markdown rendering in chat messages
- Project-based system prompt presets with scoped conversations and knowledge bases
- Generated image gallery with metadata
- Passphrase lock with lockout protection
- Model browsing and download from Hugging Face

**Platform support:**
- iOS: Text generation (Metal GPU), Whisper, image generation via Core ML (ANE acceleration).
- Android: Full feature set including image generation (MNN CPU, QNN NPU on Qualcomm), background downloads via system DownloadManager.

---

## 2. Architecture & Technology Stack

### Runtime
| Layer | Technology |
|-------|-----------|
| Framework | React Native (TypeScript) |
| Navigation | React Navigation 7 (native stack + bottom tabs) |
| State | Zustand with `persist` middleware → AsyncStorage |
| Styling | React Native StyleSheet + dynamic theme system (`src/theme/`) |

### On-Device AI
| Capability | Library | Native Backend |
|------------|---------|----------------|
| Text LLM | `llama.rn` ^0.11 | llama.cpp (C++) — Metal (iOS), CPU (Android) |
| Embeddings (RAG) | `llama.rn` embedding mode | llama.cpp — bundled `all-MiniLM-L6-v2-Q8_0.gguf` |
| RAG Storage | `@op-engineering/op-sqlite` | Native SQLite |
| Image Gen | Custom `LocalDreamModule` | `libstable_diffusion_core.so` subprocess on localhost:18081 |
| Speech-to-Text | `whisper.rn` ^0.5 | whisper.cpp (C++) |
| Remote LLM | `OpenAICompatibleProvider` | XHR SSE → OpenAI-compatible server |

### Platform Services
| Service | Library |
|---------|---------|
| File I/O | `react-native-fs` |
| Persistence | `@react-native-async-storage/async-storage` |
| Secure Storage | `react-native-keychain` |
| Device Info | `react-native-device-info` |
| Image Picker | `react-native-image-picker` |
| Document Picker | `@react-native-documents/picker` |
| Document Viewer | `@react-native-documents/viewer` |
| Zip Extraction | `react-native-zip-archive` |
| Icons | `react-native-vector-icons` (Feather) |
| Animations | `react-native-reanimated`, `lottie-react-native`, `moti` |
| Lists | `@shopify/flash-list` |
| Gradients | `react-native-linear-gradient` |
| Blur | `@react-native-community/blur` |
| Haptics | `react-native-haptic-feedback` |
| Gestures | `react-native-gesture-handler` |
| SVG | `react-native-svg` |
| Sliders | `@react-native-community/slider` |
| Onboarding | `react-native-spotlight-tour` |

### Key Design Patterns
- **Lifecycle-independent services** — Text and image generation continue running even when the user navigates away from the chat screen. Services use a subscriber/observer pattern so any screen can re-attach.
- **Selective persistence** — Only durable state is persisted (conversations, settings, downloaded model metadata). Transient UI state (streaming position, loading flags) is kept in memory only.
- **Two model loading strategies** — "Performance" keeps the model in RAM across generations; "Memory" unloads after each generation to free RAM.
- **Hybrid intent classification** — Fast regex pattern matching with optional LLM fallback for ambiguous prompts.

---

## 3. Directory Structure

```
OffgridMobile/
├── App.tsx                              # Root component: init, auth gate, navigation
├── app.json                             # RN app config (name: "OffgridMobile", displayName: "Off Grid")
├── package.json                         # Dependencies & scripts
├── tsconfig.json                        # TypeScript config
│
├── src/
│   ├── assets/
│   │   └── logo.png                     # App logo
│   │
│   ├── components/                      # Reusable UI components
│   │   ├── AnimatedEntry.tsx            # Animated mount/unmount wrapper
│   │   ├── AnimatedListItem.tsx         # Animated list item wrapper
│   │   ├── AnimatedPressable.tsx        # Animated press feedback wrapper
│   │   ├── AppSheet.tsx                 # Bottom sheet wrapper
│   │   ├── AppSheet.styles.ts           # Bottom sheet styles
│   │   ├── Button.tsx                   # Styled button
│   │   ├── Card.tsx                     # Card layout
│   │   ├── ChatInput/                   # Message input bar (text, voice, attachments, image mode)
│   │   │   ├── index.tsx                # Main ChatInput component
│   │   │   ├── Attachments.tsx          # Document/image attachment picker and preview
│   │   │   ├── Toolbar.tsx              # Input toolbar (send, voice, attachments, image mode)
│   │   │   ├── Voice.ts                 # Voice recording integration
│   │   │   └── styles.ts               # ChatInput styles
│   │   ├── ChatMessage/                 # Single message bubble (streaming, images, metadata)
│   │   │   ├── index.tsx                # Main ChatMessage component
│   │   │   ├── components/
│   │   │   │   ├── ActionMenuSheet.tsx  # Long-press action menu + EditSheet for inline message editing
│   │   │   │   ├── BlinkingCursor.tsx   # Streaming cursor animation
│   │   │   │   ├── GenerationMeta.tsx   # Generation metadata display
│   │   │   │   ├── MessageAttachments.tsx # Image/document attachment rendering
│   │   │   │   ├── MessageContent.tsx   # Message text/markdown rendering
│   │   │   │   └── ThinkingBlock.tsx    # Collapsible thinking block
│   │   │   ├── types.ts                 # ChatMessage types
│   │   │   ├── utils.ts                 # ChatMessage utilities
│   │   │   └── styles.ts               # ChatMessage styles
│   │   ├── checklist/                   # Onboarding checklist components
│   │   │   ├── index.ts                 # Checklist exports
│   │   │   ├── ProgressBar.tsx          # Animated checklist progress bar
│   │   │   ├── useOnboardingSteps.ts    # Onboarding step definitions
│   │   │   ├── animations.ts            # Checklist animations
│   │   │   └── types.ts                 # Checklist types
│   │   ├── onboarding/                  # Onboarding spotlight & sheet components
│   │   │   ├── index.ts                 # Onboarding exports
│   │   │   ├── OnboardingSheet.tsx      # Onboarding bottom sheet
│   │   │   ├── PulsatingIcon.tsx        # Animated pulsating icon
│   │   │   ├── useOnboardingSheet.ts    # Onboarding sheet hook
│   │   │   ├── spotlightConfig.tsx      # Spotlight step definitions per screen
│   │   │   └── spotlightState.ts        # Reactive spotlight state management
│   │   ├── GenerationSettingsModal/     # Generation settings modal (split into sections)
│   │   │   ├── index.tsx                # Main modal component
│   │   │   ├── TextGenerationSection.tsx # Text generation parameters
│   │   │   ├── PerformanceSection.tsx   # Performance tuning (threads, GPU, batch)
│   │   │   ├── ImageGenerationSection.tsx # Image generation parameters
│   │   │   ├── ImageQualitySliders.tsx  # Image quality slider controls
│   │   │   ├── ConversationActionsSection.tsx # Conversation actions (clear, etc.)
│   │   │   └── styles.ts               # Settings modal styles
│   │   ├── ModelSelectorModal/          # Model picker modal (text + image models, local + remote)
│   │   │   ├── index.tsx                # Main modal component
│   │   │   └── styles.ts               # Modal styles
│   │   ├── RemoteServerModal/           # Add/edit remote LLM server form
│   │   │   └── index.tsx                # Server config, connection test, model discovery
│   │   ├── VoiceRecordButton/           # Long-press voice recording with waveform
│   │   │   ├── index.tsx                # Main button component
│   │   │   ├── states.tsx               # Recording state UI variants
│   │   │   └── styles.ts               # Button styles
│   │   ├── CustomAlert.tsx              # Alert dialog
│   │   ├── DebugSheet.tsx               # Debug info bottom sheet
│   │   ├── MarkdownText.tsx             # Markdown rendering component
│   │   ├── ModelCard.tsx                # Model browser card with compact/full modes, icon actions
│   │   ├── ModelCard.styles.ts          # ModelCard extracted styles
│   │   ├── ModelCardContent.tsx         # ModelCard content sub-component
│   │   ├── ProjectSelectorSheet.tsx     # Project picker bottom sheet
│   │   ├── ThinkingIndicator.tsx        # Thinking/loading indicator
│   │   ├── ToolPickerSheet.tsx          # Tool selection bottom sheet (enable/disable tools)
│   │   └── index.ts                     # Component exports
│   │
│   ├── screens/                         # Screen components
│   │   ├── OnboardingScreen.tsx         # Welcome slides
│   │   ├── ModelDownloadScreen.tsx      # First model download during onboarding
│   │   ├── HomeScreen/                  # Dashboard: active models, memory, recent chats
│   │   │   ├── index.tsx                # Main HomeScreen component
│   │   │   ├── styles.ts               # HomeScreen styles
│   │   │   ├── components/
│   │   │   │   ├── ActiveModelsSection.tsx  # Active model cards
│   │   │   │   ├── RecentConversations.tsx  # Recent chat list
│   │   │   │   ├── ModelPickerSheet.tsx     # Model selection bottom sheet
│   │   │   │   └── LoadingOverlay.tsx       # Loading state overlay
│   │   │   └── hooks/
│   │   │       ├── useHomeScreen.ts         # Main home screen hook
│   │   │       └── useModelLoading.ts       # Model loading hook
│   │   ├── ChatScreen/                  # Main chat interface
│   │   │   ├── index.tsx                # Main ChatScreen component
│   │   │   ├── ChatScreenComponents.tsx # Extracted sub-components
│   │   │   ├── ChatModalSection.tsx     # Modal overlays (model selector, settings, etc.)
│   │   │   ├── MessageRenderer.tsx      # Message list rendering
│   │   │   ├── useChatScreen.ts         # Main chat screen hook
│   │   │   ├── useChatGenerationActions.ts # Text/image generation actions
│   │   │   ├── useChatModelActions.ts   # Model loading/switching actions
│   │   │   ├── useSaveImage.ts          # Image save-to-device logic
│   │   │   ├── types.ts                 # ChatScreen types
│   │   │   ├── styles.ts               # ChatScreen styles
│   │   │   └── stylesImage.ts           # Image generation styles
│   │   ├── ChatsListScreen.tsx          # Conversation list
│   │   ├── ModelsScreen/                # Model browser (text + image tabs)
│   │   │   ├── index.tsx                # Main ModelsScreen component
│   │   │   ├── TextModelsTab.tsx        # Text model browsing tab
│   │   │   ├── ImageModelsTab.tsx       # Image model browsing tab
│   │   │   ├── TextFiltersSection.tsx   # Text model filter UI
│   │   │   ├── ImageFilterBar.tsx       # Image model filter UI
│   │   │   ├── useTextModels.ts         # Text model browsing hook
│   │   │   ├── useImageModels.ts        # Image model browsing hook
│   │   │   ├── useModelsScreen.ts       # Main models screen hook
│   │   │   ├── useNotifRationale.ts     # Notification permission rationale
│   │   │   ├── imageDownloadActions.ts  # Image model download logic
│   │   │   ├── constants.ts             # ModelsScreen constants
│   │   │   ├── types.ts                 # ModelsScreen types
│   │   │   ├── utils.ts                 # ModelsScreen utilities
│   │   │   ├── styles.ts               # Text models styles
│   │   │   └── imageStyles.ts           # Image models styles
│   │   ├── ModelSettingsScreen/         # LLM + image gen parameters (split into sections)
│   │   │   ├── index.tsx                # Main ModelSettingsScreen component
│   │   │   ├── TextGenerationSection.tsx # Text generation settings
│   │   │   ├── PerformanceSection.tsx   # Performance tuning section
│   │   │   ├── ImageGenerationSection.tsx # Image generation settings
│   │   │   ├── SystemPromptSection.tsx  # System prompt editor
│   │   │   └── styles.ts               # ModelSettingsScreen styles
│   │   ├── GalleryScreen/               # Generated image gallery
│   │   │   ├── index.tsx                # Main GalleryScreen component
│   │   │   ├── FullscreenViewer.tsx     # Fullscreen image viewer with zoom
│   │   │   ├── GridItem.tsx             # Gallery grid item
│   │   │   ├── useGalleryActions.ts     # Gallery actions hook (save, delete, share)
│   │   │   └── styles.ts               # GalleryScreen styles
│   │   ├── DownloadManagerScreen/       # Active downloads (modal)
│   │   │   ├── index.tsx                # Main DownloadManagerScreen component
│   │   │   ├── items.tsx                # Download item components
│   │   │   ├── useDownloadManager.ts    # Download manager hook
│   │   │   └── styles.ts               # DownloadManagerScreen styles
│   │   ├── ProjectsScreen.tsx           # Projects list
│   │   ├── ProjectDetailScreen.tsx      # View project + linked chats + knowledge base entry
│   │   ├── ProjectDetailScreen.styles.ts # ProjectDetailScreen styles
│   │   ├── ProjectChatsScreen.tsx       # Conversations scoped to a project
│   │   ├── KnowledgeBaseScreen.tsx      # Project knowledge base (upload, delete, view documents)
│   │   ├── KnowledgeBaseScreen.styles.ts # KnowledgeBaseScreen styles
│   │   ├── DocumentPreviewScreen.tsx    # Full-text preview of an ingested document
│   │   ├── ProjectEditScreen.tsx        # Create/edit project
│   │   ├── RemoteServersScreen.tsx      # Remote LLM server list (add, edit, delete, set active)
│   │   ├── SettingsScreen.tsx           # Settings hub
│   │   ├── VoiceSettingsScreen.tsx      # Whisper model management
│   │   ├── DeviceInfoScreen.tsx         # Hardware specs
│   │   ├── StorageSettingsScreen.tsx    # Per-model storage usage
│   │   ├── StorageSettingsScreen.styles.ts # StorageSettingsScreen styles
│   │   ├── OrphanedFilesSection.tsx     # Orphaned model file cleanup UI
│   │   ├── SecuritySettingsScreen.tsx   # Passphrase toggle + change
│   │   ├── LockScreen.tsx              # Passphrase entry with lockout
│   │   ├── PassphraseSetupScreen.tsx    # Initial passphrase creation
│   │   └── index.ts                     # Screen exports
│   │
│   ├── navigation/
│   │   ├── AppNavigator.tsx             # Root stack + tab navigator definitions
│   │   ├── types.ts                     # Navigation param types
│   │   └── index.ts
│   │
│   ├── stores/                          # Zustand state stores
│   │   ├── appStore.ts                  # App-wide state (models, settings, device, gallery)
│   │   ├── chatStore.ts                 # Conversations + messages + streaming
│   │   ├── authStore.ts                 # Auth state + lockout
│   │   ├── projectStore.ts             # Projects (system prompt presets)
│   │   ├── remoteServerStore.ts        # Remote servers, discovered models, active server/model
│   │   └── whisperStore.ts             # Whisper model state
│   │
│   ├── services/                        # Business logic & native bridges
│   │   ├── llm.ts                       # LLMService — llama.rn context, streaming, GPU
│   │   ├── llmTypes.ts                  # LLM type definitions (extracted)
│   │   ├── llmMessages.ts              # LLM message building/formatting (extracted)
│   │   ├── llmHelpers.ts               # LLM helper utilities (extracted, includes 3-attempt init fallback)
│   │   ├── llmSafetyChecks.ts          # Model validation (GGUF magic, version, size) + memory checks
│   │   ├── activeModelService/          # Singleton — load/unload text & image models (folder)
│   │   │   ├── index.ts                # Main service entry point
│   │   │   ├── loaders.ts              # Model loading logic
│   │   │   ├── memory.ts               # Memory budget calculations
│   │   │   ├── types.ts                # Service types
│   │   │   └── utils.ts                # Service utilities
│   │   ├── modelManager/               # Download, store, track model files (folder)
│   │   │   ├── index.ts                # Main service entry point
│   │   │   ├── download.ts             # Download orchestration
│   │   │   ├── downloadHelpers.ts      # Download helper utilities
│   │   │   ├── scan.ts                 # Model file scanning & discovery
│   │   │   ├── storage.ts              # Storage management
│   │   │   ├── imageSync.ts            # Image model download sync/recovery
│   │   │   ├── restore.ts              # Download restore after app kill
│   │   │   └── types.ts                # Service types
│   │   ├── providers/                  # LLM provider abstraction layer
│   │   │   ├── types.ts                # LLMProvider interface, GenerationOptions, StreamCallbacks
│   │   │   ├── localProvider.ts        # Local GGUF provider — delegates to llmService
│   │   │   ├── openAICompatibleProvider.ts # Remote server provider — XHR SSE streaming
│   │   │   ├── registry.ts             # ProviderRegistry singleton with listener support
│   │   │   └── index.ts                # Provider exports
│   │   ├── rag/                        # Project-scoped RAG knowledge base
│   │   │   ├── chunking.ts             # Paragraph-aware text chunking with sliding-window overflow
│   │   │   ├── database.ts             # op-sqlite schema + CRUD for chunks and documents
│   │   │   ├── embedding.ts            # On-device MiniLM embeddings via llama.rn embedding mode
│   │   │   ├── retrieval.ts            # Cosine similarity ranking + XML-safe prompt formatting
│   │   │   ├── vectorMath.ts           # Dot product, magnitude, cosine similarity (pure TS)
│   │   │   └── index.ts                # ragService singleton
│   │   ├── generationService.ts        # Lifecycle-independent text generation (local + remote routing)
│   │   ├── imageGenerationService.ts   # Lifecycle-independent image generation
│   │   ├── localDreamGenerator.ts      # ONNX SD wrapper (native subprocess)
│   │   ├── imageGenerator.ts           # Image generator helper
│   │   ├── intentClassifier.ts         # Pattern + LLM intent detection
│   │   ├── huggingface.ts              # HF API: search, files, credibility
│   │   ├── huggingFaceModelBrowser.ts  # Image model browsing
│   │   ├── coreMLModelBrowser.ts       # iOS Core ML model discovery from Apple HF repos
│   │   ├── whisperService.ts           # Whisper model download/load/transcribe
│   │   ├── voiceService.ts             # Native voice input bridge
│   │   ├── authService.ts              # Passphrase hash + keychain
│   │   ├── hardware.ts                 # Device info, RAM, recommendations
│   │   ├── backgroundDownloadService.ts # DownloadManager bridge (Android + iOS)
│   │   ├── documentService.ts          # Document text extraction + RAG knowledge base ingestion
│   │   ├── pdfExtractor.ts             # Native PDF text extraction
│   │   ├── httpClient.ts               # XHR/SSE streaming, endpoint testing, server type detection
│   │   ├── remoteServerManager.ts      # Remote server CRUD, keychain API key storage, provider lifecycle
│   │   ├── generationToolLoop.ts       # Multi-turn tool loop orchestration (max 3 iterations, retry with backoff)
│   │   ├── llmToolGeneration.ts        # Tool-aware LLM generation with schema injection
│   │   └── tools/                      # Tool calling subsystem
│   │       ├── index.ts                # Public exports
│   │       ├── registry.ts             # Tool definitions, OpenAI schema conversion
│   │       ├── handlers.ts             # Tool execution (web search, URL reader, calculator, datetime, device info, knowledge base)
│   │       └── types.ts                # ToolDefinition, ToolCall, ToolResult types
│   │
│   ├── hooks/
│   │   ├── useAppState.ts              # AppState foreground/background tracking
│   │   ├── useFocusTrigger.ts          # Screen focus trigger hook
│   │   ├── useVoiceRecording.ts        # Voice recording state machine
│   │   └── useWhisperTranscription.ts  # Whisper transcription hook
│   │
│   ├── types/
│   │   ├── index.ts                    # All TypeScript interfaces & type aliases
│   │   ├── global.d.ts                 # Global type declarations
│   │   └── whisper.rn.d.ts             # Whisper native module type declarations
│   │
│   ├── theme/                            # Light/dark theme system
│   │   ├── index.ts                     # useTheme() hook, getTheme(), Theme type
│   │   ├── palettes.ts                  # COLORS_LIGHT/DARK, SHADOWS_LIGHT/DARK, createElevation()
│   │   └── useThemedStyles.ts           # useThemedStyles() — memoized style factory
│   │
│   ├── constants/
│   │   ├── index.ts                    # Model recommendations, org filters, quantization info, HF config, typography, spacing
│   │   └── models.ts                   # Curated model definitions (extracted)
│   │
│   └── utils/
│       ├── coreMLModelUtils.ts         # Core ML model path resolution helpers
│       ├── generateId.ts              # Crypto-safe UUID generation
│       ├── haptics.ts                  # Haptic feedback utilities
│       ├── logger.ts                   # Logger utility (replaces console.log/warn/error)
│       └── messageContent.ts           # Strip LLM control tokens from output
│
├── android/                             # Android native code
│   └── app/src/main/java/ai/offgridmobile/
│       ├── MainActivity.kt              # Main activity
│       ├── MainApplication.kt           # Application entry point
│       ├── localdream/
│       │   ├── LocalDreamModule.kt      # Stable Diffusion native module
│       │   └── LocalDreamPackage.kt     # Package registration
│       ├── download/
│       │   ├── DownloadManagerModule.kt # Background download native module
│       │   ├── DownloadManagerPackage.kt # Package registration
│       │   ├── DownloadForegroundService.kt # Foreground service to prevent download throttling
│       │   └── DownloadCompleteBroadcastReceiver.kt # Broadcast receiver
│       └── pdf/
│           ├── PDFExtractorModule.kt    # Native PDF text extraction
│           └── PDFExtractorPackage.kt   # Package registration
│
├── ios/                                 # iOS native code
│   ├── CoreMLDiffusionModule.swift      # Core ML image generation (root level)
│   ├── CoreMLDiffusionModule.m          # ObjC bridge (root level)
│   ├── DownloadManagerModule.swift      # iOS download manager (root level)
│   ├── DownloadManagerModule.m          # ObjC bridge (root level)
│   ├── PDFExtractorModule.swift         # Native PDF text extraction (root level)
│   ├── PDFExtractorModule.m             # ObjC bridge (root level)
│   └── OffgridMobile/
│       ├── AppDelegate.swift            # Application delegate
│       ├── OffgridMobile-Bridging-Header.h # Swift/ObjC bridging header
│       ├── CoreMLDiffusion/
│       │   └── CoreMLDiffusionModule.m  # ObjC bridge (subdirectory)
│       ├── Download/
│       │   └── DownloadManagerModule.m  # ObjC bridge (subdirectory)
│       └── PDFExtractor/
│           ├── PDFExtractorModule.m     # ObjC bridge (subdirectory)
│           └── PDFExtractorModule.swift # Swift implementation (subdirectory)
│
├── __tests__/                           # Test suites (~108 test files)
│   ├── unit/                            # Store & service unit tests
│   │   ├── stores/                      # appStore, chatStore, authStore, projectStore, whisperStore
│   │   ├── services/                    # 20+ service test files
│   │   ├── hooks/                       # Hook tests (useAppState, useChatGenerationActions, etc.)
│   │   ├── onboarding/                  # Onboarding/spotlight unit tests (6 files)
│   │   ├── screens/ModelsScreen/        # ModelsScreen utility tests
│   │   ├── constants/                   # Constants tests
│   │   ├── theme/                       # Theme palette tests
│   │   └── utils/                       # Utility tests
│   ├── integration/                     # Multi-service integration tests
│   │   ├── generation/                  # generationFlow, imageGenerationFlow
│   │   ├── models/                      # activeModelService
│   │   ├── onboarding/                  # spotlightFlowIntegration
│   │   └── stores/                      # chatStoreIntegration
│   ├── contracts/                       # Native module contract tests (7 files)
│   ├── rntl/                            # React Native Testing Library tests
│   │   ├── screens/                     # 19 screen tests
│   │   ├── components/                  # 17 component tests
│   │   ├── onboarding/                  # 5 spotlight screen tests
│   │   ├── hooks/                       # Hook tests (useFocusTrigger)
│   │   └── navigation/                  # AppNavigator tests
│   ├── specs/                           # Behavior specifications (YAML)
│   └── utils/                           # Test helpers, factories & spotlight mocks
│
├── docs/                                # Documentation
│   ├── ARCHITECTURE.md                  # System architecture & build guide
│   ├── PRIVACY_POLICY.md               # Privacy policy
│   ├── standards/
│   │   └── CODEBASE_GUIDE.md            # This file — comprehensive architecture guide
│   ├── design/
│   │   ├── DESIGN_PHILOSOPHY_SYSTEM.md  # Design system reference
│   │   └── VISUAL_HIERARCHY_STANDARD.md # Visual hierarchy guidelines
│   ├── onboarding/
│   │   └── ONBOARDING_FLOWS.md          # Onboarding spotlight flow documentation
│   └── test/
│       ├── CLAUDE_TEST_SKILL.md         # Claude test generation skill
│       ├── TEST_FLOWS.md                # End-to-end test flows
│       ├── TEST_COVERAGE_REPORT.md      # Test coverage report
│       ├── TEST_PRIORITY_MAP.md         # Test priority mapping
│       └── TEST_SPEC_FORMAT.md          # Test specification format
│
├── patches/                             # patch-package patches
```

---

## 4. Navigation & Screen Map

### Root Navigator (Stack)

```
RootStack
│
├── OnboardingScreen          (shown once, first launch)
├── ModelDownloadScreen        (shown if no models downloaded after onboarding)
├── MainTabs                   (primary app interface)
├── DownloadManagerScreen      (modal overlay)
└── GalleryScreen              (modal overlay, fullscreen image viewer)
```

### Main Tabs (Bottom Tab Navigator, 5 tabs)

```
MainTabs
│
├── HomeTab
│   └── HomeScreen
│
├── ChatsTab (Stack)
│   ├── ChatsListScreen
│   └── ChatScreen
│
├── ProjectsTab (Stack)
│   ├── ProjectsScreen
│   ├── ProjectDetailScreen
│   ├── ProjectChatsScreen
│   ├── KnowledgeBaseScreen
│   ├── DocumentPreviewScreen
│   └── ProjectEditScreen (modal presentation)
│
├── ModelsTab
│   └── ModelsScreen
│
└── SettingsTab (Stack)
    ├── SettingsScreen
    ├── ModelSettingsScreen
    ├── VoiceSettingsScreen
    ├── DeviceInfoScreen
    ├── StorageSettingsScreen
    ├── SecuritySettingsScreen
    └── RemoteServersScreen
```

### Screen Descriptions

| Screen | Purpose | Key testIDs |
|--------|---------|-------------|
| **OnboardingScreen** | 4 welcome slides (privacy, offline, model choice). Shown once. | `onboarding-screen` |
| **ModelDownloadScreen** | Recommends a model based on device RAM. User downloads or skips. | `model-download-screen` |
| **HomeScreen** | Dashboard: active text/image models, memory usage (used/total), recent conversations with message preview and smart date formatting, quick "New Chat" button. | `home-screen`, `new-chat-button` |
| **ChatScreen** | Full chat interface. Streaming messages, model selector, project selector, generation settings, image generation with live preview, voice input, document attachments, debug panel. | `chat-screen`, `chat-input`, `send-button`, `stop-button` |
| **ChatsListScreen** | Sorted conversation list with compact items. Shows title, last message preview snippet, project badge, timestamp. Swipe-to-delete. | `conversation-list` |
| **ModelsScreen** | Two sections: Text Models and Image Models. Curated recommendations by RAM, search bar, advanced filters (org, size, quantization, type, credibility). Local .gguf import. Download progress, pause/cancel. Compact card layout with icon actions. | `models-screen`, `model-list` |
| **ProjectsScreen** | List of system prompt presets. Shows name, description snippet, linked chat count. Default projects: General Assistant, Spanish Learning, Code Review, Writing Helper. | `projects-screen` |
| **ProjectDetailScreen** | Full project view: name, system prompt, description, entry points to project chats and knowledge base. | |
| **ProjectChatsScreen** | Conversations scoped to a specific project. | |
| **KnowledgeBaseScreen** | Upload, view, and delete documents in a project's knowledge base. Shows ingestion status per document. | |
| **DocumentPreviewScreen** | Full-text preview of an ingested document retrieved from the RAG database. | |
| **ProjectEditScreen** | Create/edit form: name, description, system prompt, icon selection. | |
| **RemoteServersScreen** | List of configured remote LLM servers. Add, edit, delete, and set the active server. | |
| **GalleryScreen** | 3-column image grid. Filter by conversation. Multi-select for batch delete. Save to device. View metadata (prompt, steps, seed, model). | `gallery-screen` |
| **SettingsScreen** | Hub with sections: Model Settings, Voice Settings, Security, Storage, Device Info. | `settings-screen` |
| **ModelSettingsScreen** | Sliders/inputs for: system prompt, temperature (0–2), top-p (0–1), repeat penalty (1–2), max tokens, context length, threads, batch size, GPU toggle + layers, image gen steps/guidance/resolution, loading strategy, generation details toggle. | |
| **VoiceSettingsScreen** | Download/select Whisper model (tiny/base/small, English or multilingual). | |
| **DeviceInfoScreen** | Device model, OS, total/available RAM, total/available storage, emulator flag, GPU capabilities. | |
| **StorageSettingsScreen** | Per-category storage (text models, image models, whisper, gallery). Per-model sizes. Delete from here. | |
| **SecuritySettingsScreen** | Toggle passphrase lock. Change passphrase (requires old). | |
| **LockScreen** | Passphrase input. Shows lockout timer (MM:SS) after 5 failed attempts. 5-minute lockout. | `lock-screen` |
| **PassphraseSetupScreen** | Set new passphrase with confirmation. Must match. | |
| **DownloadManagerScreen** | Modal showing all active/completed/failed downloads with progress bars, pause/resume/cancel/retry controls. | |

---

## 5. State Management (Zustand Stores)

All stores use `zustand/middleware` `persist` with AsyncStorage. Only serializable, durable data is persisted; transient UI flags are excluded via `partialize`.

### appStore (`local-llm-app-storage`)

| State Group | Fields | Notes |
|-------------|--------|-------|
| **Onboarding** | `hasCompletedOnboarding` | Set true once, never reset |
| **Device** | `deviceInfo`, `modelRecommendation` | Refreshed on app start |
| **Downloaded Models** | `downloadedModels[]`, `downloadedImageModels[]` | Metadata only; files on disk |
| **Active Models** | `activeModelId`, `activeImageModelId` | Persisted; model re-loaded on next use |
| **Loading Flags** | `isLoadingModel`, `isGeneratingImage` | Not persisted |
| **Downloads** | `downloadProgress{}`, `activeBackgroundDownloads[]` | Background downloads persisted (Android) |
| **Settings** | `systemPrompt`, `temperature`, `maxTokens`, `topP`, `repeatPenalty`, `contextLength`, `nThreads`, `nBatch`, `useGPU`, `nGPULayers`, `modelLoadingStrategy`, `flashAttention`, `kvCacheType` | All persisted |
| **Image Settings** | `imageSteps`, `imageGuidanceScale`, `imageWidth`, `imageHeight`, `imageThreads` | All persisted |
| **Intent** | `imageGenerationMode`, `autoDetectMethod`, `classifierModelId` | Persisted |
| **Tools** | `enabledTools[]` | User-selected tool IDs (default: all 5 tools enabled — `['web_search', 'calculator', 'get_current_datetime', 'get_device_info', 'read_url']`). Persisted |
| **UI** | `showGenerationDetails` | Persisted |
| **Gallery** | `generatedImages[]` | Full metadata array, persisted |

### chatStore (`local-llm-chat-storage`)

| State Group | Fields | Notes |
|-------------|--------|-------|
| **Conversations** | `conversations[]` | Full conversation objects with all messages |
| **Active** | `activeConversationId` | Which chat is currently open |
| **Streaming** | `streamingMessage`, `isStreaming`, `isThinking`, `streamingForConversationId` | Not persisted |
| **Actions** | `createConversation()`, `deleteConversation()`, `addMessage()`, `updateMessage()`, `deleteMessage()`, `deleteMessagesAfter()`, `setStreaming()`, `clearAllConversations()` | |

### authStore (`local-llm-auth-storage`)

| Field | Type | Notes |
|-------|------|-------|
| `isEnabled` | boolean | Whether passphrase lock is turned on |
| `isLocked` | boolean | Current lock state |
| `failedAttempts` | number | Resets on success |
| `lockoutUntil` | number \| null | Unix timestamp when lockout expires |
| `lastBackgroundTime` | number \| null | When app went to background (for auto-lock) |
| Constants | `MAX_ATTEMPTS = 5`, `LOCKOUT_DURATION = 5 min` | |

### projectStore (`local-llm-project-storage`)

| Field | Notes |
|-------|-------|
| `projects[]` | Array of Project objects |
| Default projects | General Assistant, Spanish Learning, Code Review, Writing Helper |
| Actions | `createProject()`, `updateProject()`, `deleteProject()`, `duplicateProject()` |

### remoteServerStore (`remote-server-storage`)

| State Group | Fields | Notes |
|-------------|--------|-------|
| **Servers** | `servers[]` | Persisted. API keys are NOT stored here — kept in system keychain by `remoteServerManager` |
| **Active** | `activeServerId` | Which server is currently selected (null = local-only) |
| **Models** | `discoveredModels{}` | Map of serverId → `RemoteModel[]`. Persisted |
| **Health** | `serverHealth{}` | Map of serverId → `{ isHealthy, lastCheck }`. Persisted |
| **Active Model** | `activeRemoteTextModelId`, `activeRemoteImageModelId` | Currently selected remote models |
| **Loading** | `isLoading`, `testingServerId`, `discoveringServerId` | Transient |
| Actions | `addServer()`, `updateServer()`, `removeServer()`, `setActiveServerId()`, `discoverModels()`, `testConnection()`, `testConnectionByEndpoint()` | |

### whisperStore (`local-llm-whisper-storage`)

| Field | Notes |
|-------|-------|
| `downloadedModelId` | Which whisper model is downloaded |
| `isLoading`, `isDownloading` | Transient flags |
| Actions | `downloadModel()`, `loadModel()`, `unloadModel()`, `deleteModel()` |

---

## 6. Data Models & Types

### Core Entities

```
ModelInfo                    # Model from HuggingFace API
├── id, name, author
├── description, downloads, likes, tags
├── files: ModelFile[]
└── credibility?: ModelCredibility

ModelFile                    # A specific quantized file for a model
├── name, size, quantization, downloadUrl
└── mmProjFile?: { name, size, downloadUrl }   # Vision companion

DownloadedModel              # A model file on disk
├── id, name, author
├── filePath, fileName, fileSize, quantization
├── downloadedAt, credibility?
└── isVisionModel?, mmProjPath?, mmProjFileName?, mmProjFileSize?

ONNXImageModel               # Stable Diffusion model on disk
├── id, name, description
├── modelPath, downloadedAt, size
├── style? ('creative' | 'photorealistic' | 'anime')
└── backend? ('mnn' | 'qnn')

Conversation
├── id, title, modelId
├── messages: Message[]
├── createdAt, updatedAt
└── projectId?

Message
├── id, role ('user' | 'assistant' | 'system' | 'tool')
├── content, timestamp
├── isStreaming?, isThinking?, isSystemInfo?
├── attachments?: MediaAttachment[]
├── generationTimeMs?
├── generationMeta?: GenerationMeta
├── toolCallId? (for tool result messages)
├── toolCalls?: Array<{ id?, name, arguments }> (for assistant tool call messages)
└── toolName? (for tool result messages)

MediaAttachment
├── id, type ('image' | 'document'), uri
├── mimeType?, width?, height?, fileName?
├── textContent? (extracted document text)
└── fileSize?

GenerationMeta
├── gpu, gpuBackend?, gpuLayers?
├── cacheType? (KV cache quantization type, e.g. 'f16', 'q8_0', 'q4_0')
├── modelName?
├── tokensPerSecond?, decodeTokensPerSecond?
├── timeToFirstToken?, tokenCount?
├── steps?, guidanceScale?, resolution?

GeneratedImage
├── id, prompt, negativePrompt?
├── imagePath, width, height
├── steps, seed, modelId
├── createdAt, conversationId?

Project
├── id, name, description, systemPrompt
├── icon?, createdAt, updatedAt

RemoteServer
├── id, name, endpoint, providerType ('openai-compatible' | 'anthropic')
├── createdAt, lastHealthCheck?, isHealthy?, notes?
└── apiKey is NOT stored here — kept in system keychain

RemoteModel
├── id, name, serverId
├── capabilities: { supportsVision, supportsToolCalling, supportsThinking, maxContextLength?, family? }
├── details?, lastUpdated

RagDocument                  # A document ingested into a project knowledge base
├── id, projectId, name, filePath
├── fileSize, mimeType, createdAt
└── chunkCount

RagChunk                     # A chunk of text with its embedding vector
├── id, documentId, projectId
├── content, position (chunk index within document)
└── embedding: number[]      (384-dim MiniLM vector, stored as JSON)
```

### Enums & Aliases

| Type | Values | Used By |
|------|--------|---------|
| `ModelSource` | `'lmstudio' \| 'official' \| 'verified-quantizer' \| 'community'` | Credibility badges |
| `ImageGenerationMode` | `'auto' \| 'manual'` | Settings: auto-detect vs explicit |
| `AutoDetectMethod` | `'pattern' \| 'llm'` | Settings: fast regex vs LLM fallback |
| `ModelLoadingStrategy` | `'performance' \| 'memory'` | Settings: keep loaded vs load-on-demand |
| `ImageModeState` | `'auto' \| 'force'` | Chat input toggle |
| `BackgroundDownloadStatus` | `'pending' \| 'running' \| 'paused' \| 'completed' \| 'failed' \| 'unknown'` | Download manager |
| `SoCVendor` | `'qualcomm' \| 'mediatek' \| 'exynos' \| 'tensor' \| 'apple' \| 'unknown'` | SoC detection |
| `CacheType` | `'f16' \| 'q8_0' \| 'q4_0'` | KV cache quantization |

### Additional Interfaces

```
SoCInfo                      # System-on-Chip detection
├── vendor: SoCVendor
├── hasNPU: boolean
├── qnnVariant?: '8gen2' | '8gen1' | 'min'
└── appleChip?: 'A14' | 'A15' | 'A16' | 'A17Pro' | 'A18'

ImageModelRecommendation     # Per-device image model recommendation
├── recommendedBackend: 'qnn' | 'mnn' | 'coreml' | 'all'
├── qnnVariant?, recommendedModels?
├── bannerText, warning?
└── compatibleBackends: Array<'mnn' | 'qnn' | 'coreml'>

PersistedDownloadInfo        # Persisted download state for restore after app kill
├── modelId, fileName, quantization, author, totalBytes
├── mainFileSize?, mmProjFileName?, mmProjFileSize?
└── imageModel* fields (for image model download restore)
```

---

## 7. Core Services

### LLMService (`src/services/llm.ts` + `llmTypes.ts`, `llmMessages.ts`, `llmHelpers.ts`, `llmSafetyChecks.ts`)

The central service for on-device text inference.

**Responsibilities:**
- Initialize and manage llama.rn `LlamaContext`
- Configure GPU offloading (Metal on iOS, disabled on Android for stability)
- Stream tokens to callbacks during generation
- Track performance metrics (tok/s, TTFT, decode tok/s)
- Handle context window management (85% utilization cap, smart truncation)
- Support multimodal/vision models via mmproj files
- KV cache management (clear between conversations)
- Session caching for repeated system prompts
- Tool calling capability detection via jinja chat template introspection
- Configurable KV cache type (f16, q8_0, q4_0) and flash attention toggle
- Parameter constraint enforcement (GPU/flash attention/KV cache compatibility on Android)
- Comprehensive diagnostic logging (`[LLM]` tags) throughout the load pipeline: model validation (file size, GGUF magic, GGUF version), user settings resolution, memory estimation, and numbered init attempts (1/3 GPU → 2/3 CPU → 3/3 CPU@2048) with full error chains on failure

**Platform defaults:**

| Parameter | iOS | Android |
|-----------|-----|---------|
| Threads | 4 | 6 |
| Batch size | 256 | 256 |
| GPU layers | 99 (Metal) | 0 (disabled) |
| Context length | 2048 | 2048 |

### ActiveModelService (`src/services/activeModelService/`)

Singleton that manages which models are loaded in native memory. Split into `index.ts`, `loaders.ts`, `memory.ts`, `types.ts`, `utils.ts`.

**Responsibilities:**
- Load/unload text models (llama.rn context creation)
- Load/unload image models (LocalDream subprocess)
- Memory budget enforcement (60% of device RAM max, warning at 50%)
- Memory estimation: 1.5x file size for text, 1.8x for image
- Automatic unload of previous model before loading new one
- Observable pattern for UI subscriptions

### ModelManager (`src/services/modelManager/`)

Handles model file lifecycle on disk. Split into `index.ts`, `download.ts`, `downloadHelpers.ts`, `scan.ts`, `storage.ts`, `imageSync.ts`, `restore.ts`, `types.ts`.

**Responsibilities:**
- Download from Hugging Face (background downloads exclusively on both platforms)
- Parallel mmproj downloads alongside main model for vision models
- Import local `.gguf` files from device storage (Bring Your Own Model)
- Store text models in `Documents/local-llm/models/`
- Store image models in `Documents/image_models/`
- Track downloaded model metadata in AsyncStorage
- Handle vision model companion files (mmproj)
- Verify file integrity
- Delete models and clean up
- Recover/restore downloads after app kill (both iOS and Android)
- Image model download sync and recovery (`imageSync.ts`)

### GenerationService (`src/services/generationService.ts`, 7KB)

Lifecycle-independent text generation manager.

**Responsibilities:**
- Manage generation state outside of any screen's lifecycle
- Subscriber pattern: screens subscribe/unsubscribe to generation state
- Handles app backgrounding during generation
- Tracks generation progress and completion

### ImageGenerationService (`src/services/imageGenerationService.ts`, 10KB)

Lifecycle-independent image generation manager.

**Responsibilities:**
- Orchestrate the full image generation pipeline
- Listen to native `LocalDreamProgress` events
- Save generated images to gallery store
- Insert generated image as assistant message in chat
- Preview path management during generation
- Continue generating even when user navigates away

### IntentClassifier (`src/services/intentClassifier.ts`, 12KB)

Determines whether a user message should trigger text generation or image generation.

**Two-stage pipeline:**

1. **Pattern matching (fast, no LLM needed):**
   - 45+ image patterns: "draw", "generate image", "paint", "create a picture", art styles, DALL-E references, negative prompts, resolution specs
   - 40+ text patterns: questions ("what is", "how do"), code requests, math, analysis, explanation
   - Short messages (<10 chars) → text
   - Multiple sentences with punctuation → text

2. **LLM classification (fallback for ambiguous cases):**
   - Simple yes/no prompt to the LLM
   - Can use a separate lightweight classifier model
   - Result cached (max 100 entries)
   - Falls back to text if LLM unavailable

### HuggingFaceService (`src/services/huggingface.ts`, 15KB)

API client for model discovery.

**Key methods:**
- `searchModels(query, options)` — GGUF filter, sort by downloads
- `getModelFiles(modelId)` — List quantized files with sizes, auto-pair mmproj companions
- `getDownloadUrl(modelId, fileName)` — Construct download URL

**Credibility determination:**
- LM Studio authors (highest) → Official model creators → Verified quantizers → Community

### WhisperService (`src/services/whisperService.ts`, 9KB)

Speech-to-text model management and transcription.

**Models available:**

| Model | Size | Language |
|-------|------|----------|
| tiny.en | 75 MB | English only |
| tiny | 75 MB | Multilingual |
| base.en | 142 MB | English only |
| base | 142 MB | Multilingual |
| small.en | 466 MB | English only |

**Transcription modes:**
- **Realtime:** Streams partial results every ~3 seconds
- **File:** Batch process a recorded audio file

### AuthService (`src/services/authService.ts`, 3KB)

Passphrase management.

- Hash passphrase with 1000 rounds of iteration
- Store in device Keychain (encrypted native storage)
- Methods: `setPassphrase()`, `verifyPassphrase()`, `hasPassphrase()`, `removePassphrase()`

### BackgroundDownloadService (`src/services/backgroundDownloadService.ts`)

Bridge to native download managers on both platforms. This is now the **only** download method (foreground downloads removed).

- Downloads continue even after app is killed (both Android and iOS)
- Android: Persists download state in SharedPreferences, 500ms polling for progress; foreground service keeps downloads alive during doze
- iOS: Uses background URLSession with delegate-based progress callbacks
- Emits events: `DownloadProgress`, `DownloadComplete`, `DownloadError`
- Moves completed files from Downloads temp to models directory
- Tracks event delivery separately from completion status to prevent race conditions
- Download restore after app kill via `modelManager/restore.ts`
- Image model download sync/recovery via `modelManager/imageSync.ts`

### Tool Calling Services (`src/services/tools/`, `src/services/generationToolLoop.ts`, `src/services/llmToolGeneration.ts`)

On-device function calling for compatible models.

**Tool Registry (`tools/registry.ts`):**
- Defines **5 built-in tools**: `web_search`, `calculator`, `get_current_datetime`, `get_device_info`, `read_url`
- Converts tool definitions to OpenAI function calling schema for llama.cpp
- Generates system prompt hints listing available tools

**Tool Handlers (`tools/handlers.ts`):**
- `web_search` — Scrapes Brave Search, returns top 5 results with clickable URLs
- `calculator` — Recursive descent parser (no `eval()`), supports `+, -, *, /, %, ^, ()`
- `get_current_datetime` — Formatted date/time with optional timezone
- `get_device_info` — Battery, storage, memory via `react-native-device-info`
- `read_url` — Fetches and reads web page content, strips HTML, truncates to 80% of context window
- `search_knowledge_base` — Semantic search over a project's RAG document store; only available in project conversations that have documents ingested

**Tool Loop (`generationToolLoop.ts`):**
- Orchestrates multi-turn tool execution: LLM → parse → execute → inject → repeat
- Hard limits: 3 iterations, 5 total tool calls
- Supports structured tool calls AND fallback text parsing for smaller models:
  - JSON format: `<tool_call>{"name":"web_search","arguments":{"query":"test"}}</tool_call>`
  - XML-like format: `<tool_call><function=web_search><parameter=query>test</tool_call>`
  - Unclosed tags: handles models that hit EOS without emitting `</tool_call>`
- Empty web search queries fall back to last user message
- **Retry with backoff** (`callLLMWithRetry`): Up to 4 retries with linear backoff (1s, 2s, 3s, …) for transient native context errors ("Context is busy", "already in progress", etc.). Non-retryable errors ("No model loaded", "aborted") fail immediately.
- **Context release pause** (500ms): Delay after tool execution before next LLM call, allowing native context to fully release

**LLM Tool Generation (`llmToolGeneration.ts`):**
- Reserves ~100 tokens per tool in context window for schema injection
- Passes tool schemas via `tool_choice: 'auto'` to llama.rn
- Prefers `completionResult.tool_calls` over streamed tool calls — streaming may deliver partial tool calls (name only, no arguments) while the final result contains complete data
- **`completionResult.text` fallback**: If streaming produced no tokens but the completion result has a `.text` field (can happen with thinking models), uses that as the response
- **Thinking model support**: For models with `<think>` Jinja templates, injects `<think>` tag into stream for UI display while keeping `fullResponse` clean for tool call parsing

### Remote LLM Providers (`src/services/providers/`)

A provider abstraction that allows `generationService` to route text generation to either a local GGUF model or a remote OpenAI-compatible server transparently.

**`LLMProvider` interface** (all providers implement):
- `generate(messages, options, callbacks)` — streaming generation
- `loadModel(modelId)` / `unloadModel()` / `isModelLoaded()` / `getLoadedModelId()`
- `capabilities` — `{ supportsVision, supportsToolCalling, supportsThinking }`

**`LocalProvider`** wraps `llmService`. Generation delegates to llama.rn. Model loading state is tracked separately from `llmService` (which is managed by `activeModelService`).

**`OpenAICompatibleProvider`** streams from a remote server:
- Builds OpenAI-format `messages` array (including base64 image parts for vision)
- Streams via `XMLHttpRequest` `onprogress` with incremental SSE parsing
- Accumulates tool call deltas across chunks and delivers complete calls at `finish_reason`
- Guarantees `onComplete` is called even for `finish_reason: 'length'` or absent finish reasons
- Calls `this.abortController.abort()` on API error to immediately stop the XHR

**`ProviderRegistry`** singleton:
- Maintains `Map<id, LLMProvider>` + `activeProviderId`
- `generationService` reads `activeServerId` from `remoteServerStore` and calls `providerRegistry.getProvider(activeServerId)` for each generation
- Notifies subscribers on provider change (used to keep `activeServerId` store in sync)

### Remote Server Manager (`src/services/remoteServerManager.ts`)

Singleton that owns the lifecycle of remote server configurations and their providers.

- **Add/update/remove** servers, creating/destroying the corresponding `OpenAICompatibleProvider`
- **API key storage**: keys stored via `react-native-keychain` under service name `ai.offgridmobile.servers`; never written to `AsyncStorage` or the Zustand store
- **Model discovery**: calls `/v1/models` and maps results to `RemoteModel` with capability heuristics
- **Connection testing**: `testConnectionByEndpoint()` — pings health endpoints in order (Ollama, generic OpenAI)
- **Active model selection**: `setActiveRemoteTextModel(serverId, modelId)` loads the model on the provider and updates `remoteServerStore`
- **App startup**: `initializeProviders()` must be called in `App.tsx` to re-register providers and re-discover models for all persisted servers

### HTTP Client (`src/services/httpClient.ts`)

Low-level HTTP utilities for remote server communication.

- **`createStreamingRequest(url, body, headers, onEvent, timeout, signal?)`** — XHR-based SSE streaming. `AbortSignal` wires directly to `xhr.abort()` so cancellations propagate immediately.
- **`processSSELines(data, onEvent)`** — incremental SSE line parser that handles partial lines across `onprogress` calls
- **`testEndpoint(endpoint, apiKey?)`** — tries Ollama `/api/tags`, then OpenAI `/v1/models`; returns `ServerTestResult`
- **`detectServerType(endpoint)`** — heuristic detection of server software (Ollama, LM Studio, LocalAI)
- **`isPrivateNetworkEndpoint(endpoint)`** — returns false for public internet IPs/hostnames; used to warn users
- **`imageToBase64DataUrl(uri)`** — converts a `file://` image URI to a base64 data URL for vision requests

### RAG Knowledge Base (`src/services/rag/`)

Project-scoped retrieval-augmented generation pipeline running entirely on-device.

**Ingestion flow:**
1. `documentService.ingestDocumentToKnowledgeBase(projectId, attachment)` — called from `KnowledgeBaseScreen`
2. `ragService.ingestDocument(projectId, filePath, name, mimeType)` — orchestrates chunking + embedding + storage
3. `chunking.chunkText(text)` — splits by paragraph; oversized paragraphs use sliding-window with overlap
4. `embedding.embedText(text)` — calls llama.rn in embedding mode with the bundled `all-MiniLM-L6-v2-Q8_0.gguf`; returns a 384-dim float vector
5. `database.insertChunks(chunks)` — stores text + JSON-serialised vector in `op-sqlite`

**Retrieval flow (called by `search_knowledge_base` tool):**
1. `ragService.searchProject(projectId, query, topK=5)`
2. Query text is embedded with the same MiniLM model
3. All chunks for the project are loaded from SQLite and cosine-similarity scored against the query vector
4. Top-K chunks are returned sorted by score
5. `retrieval.formatForPrompt(chunks)` wraps them in `<knowledge_base>…</knowledge_base>` XML for the LLM

**`vectorMath.ts`:** Pure TypeScript cosine similarity — no native dependency, fully testable.

**Database schema (op-sqlite):**
```sql
documents(id, project_id, name, file_path, file_size, mime_type, created_at)
chunks(id, document_id, project_id, content, position, embedding TEXT)
```

---

## 8. Native Integration Layer

### Android Native Modules

#### LocalDreamModule (`android/.../localdream/LocalDreamModule.kt`)

Stable Diffusion image generation via a native subprocess.

**Architecture:**
- Spawns `libstable_diffusion_core.so` as a subprocess
- Subprocess runs an HTTP server on `localhost:18081`
- TypeScript layer makes HTTP POST requests for generation
- Receives SSE (Server-Sent Events) stream with progress + base64 preview images

**Backend support:**

| Backend | Hardware | Model Format | Files |
|---------|----------|-------------|-------|
| MNN (CPU) | All Android | `.mnn` | CLIP, UNet, VAE decoder, tokenizer |
| QNN (NPU) | Qualcomm Snapdragon | `.bin` | Same components, Hexagon DSP optimized |

**Key native methods:**
- `loadModel(path)`, `unloadModel()`, `isModelLoaded()`
- `generateImage(prompt, negativePrompt, steps, guidanceScale, width, height, seed)`
- `cancelGeneration()`
- `saveRgbAsPng(base64, width, height, path)`
- `isNpuSupported()` — checks for Qualcomm chipset

**QNN runtime libraries:** Extracted from assets to `runtime_libs/`:
- `libQnnHtp.so` (Hexagon DSP backend)
- `libQnnSystem.so` (QNN system library)

#### DownloadManagerModule (`android/.../download/DownloadManagerModule.kt`)

Android system DownloadManager integration with foreground service support.

**Key native methods:**
- `startDownload(url, fileName)` — enqueues in system DownloadManager and starts `DownloadForegroundService`
- `cancelDownload(downloadId)` — cancels download and stops foreground service if no active downloads remain
- `getActiveDownloads()` — reads from SharedPreferences
- `getDownloadProgress(downloadId)` — queries DownloadManager
- `moveCompletedDownload(downloadId, destPath)` — moves from temp to models dir
- `startProgressPolling()` / `stopProgressPolling()` — 500ms interval

**Foreground service lifecycle:**
- `DownloadForegroundService` (dataSync type) starts when any download is enqueued
- Automatically stopped via `stopForegroundServiceIfIdle()` when all downloads reach a terminal state (completed, failed, or cancelled)
- Prevents Android doze/battery-saver from throttling or pausing large downloads
- Non-fatal: if the service fails to start/stop, download continues normally

### iOS Native Modules

#### CoreMLDiffusionModule (`ios/.../CoreMLDiffusion/CoreMLDiffusionModule.swift`)

Stable Diffusion image generation via Apple's `ml-stable-diffusion` Core ML pipeline.

**Architecture:**
- In-process `StableDiffusionPipeline` (no subprocess)
- Core ML auto-dispatches across CPU, GPU (Metal), and ANE (Apple Neural Engine)
- DPM-Solver multistep scheduler for faster convergence
- `reduceMemory` mode for iPhones with limited RAM

**Key native methods:**
- `loadModel(params)`, `unloadModel()`, `isModelLoaded()`
- `generateImage(params)` — with step-by-step progress callbacks
- `cancelGeneration()` — boolean flag checked between steps
- `isNpuSupported()` — always true (Core ML uses ANE automatically)

**Model format:** `.mlmodelc` compiled Core ML models from Apple's HuggingFace repos.

#### DownloadManagerModule (`ios/.../Download/DownloadManagerModule.swift`)

iOS background download manager using `URLSession` with background configuration.

**Key differences from Android:**
- Delegate-based progress callbacks (not polling)
- Survives app suspension but NOT user force-quit
- Temporary file on completion must be moved immediately

**Additional iOS dependencies:**
- `llama.rn` for Metal-accelerated LLM inference (99 GPU layers by default)
- `whisper.rn` for speech-to-text
- Standard RN library natives for everything else

### Third-Party Native Bindings

| Package | Native Functionality |
|---------|---------------------|
| `llama.rn` | llama.cpp context creation, completion streaming, GPU offload |
| `whisper.rn` | whisper.cpp context, realtime + file transcription |
| `react-native-fs` | File read/write/download/stat/mkdir |
| `react-native-device-info` | RAM, device model, OS, emulator detection |
| `react-native-keychain` | Encrypted credential storage |
| `react-native-image-picker` | Camera and gallery image selection |
| `react-native-zip-archive` | Model archive extraction |

---

## 9. Product Flows — Detailed

This section expands on every testable flow, grouped by feature area. Each flow includes the **trigger**, **step-by-step behavior**, **services/stores involved**, and **edge cases**.

---

### 9.1 App Initialization & Onboarding

#### 9.1.1 Cold Start Sequence

**Trigger:** User taps app icon (fresh install or subsequent launch).

**Steps:**
1. `App.tsx` mounts → shows loading screen
2. Hardware service queries device info (RAM, model, OS) → stores in `appStore.deviceInfo`
3. Model recommendations calculated from RAM tier → `appStore.modelRecommendation`
4. ModelManager syncs downloaded models list (verifies files still exist on disk)
5. On Android: sync background download state from SharedPreferences
6. AuthStore checked: if `isEnabled && passphrase exists` → show `LockScreen`
7. Otherwise, check `hasCompletedOnboarding`:
   - `false` → navigate to `OnboardingScreen`
   - `true` + no downloaded models → `ModelDownloadScreen`
   - `true` + has models → `MainTabs`

**Services:** HardwareService, ModelManager, AuthService, BackgroundDownloadService (Android)
**Stores:** appStore, authStore

#### 9.1.2 Onboarding Flow

**Trigger:** First app launch (`hasCompletedOnboarding === false`).

**Steps:**
1. Display 4 slides: Welcome → Privacy → Offline → Choose Model
2. User swipes through or taps "Next"
3. On final slide, tap "Get Started"
4. `appStore.setHasCompletedOnboarding(true)`
5. Navigate to `ModelDownloadScreen`

**Slides content:**
| Slide | Title | Message |
|-------|-------|---------|
| 1 | Welcome to Off Grid | Run AI models directly on your device. No internet required, complete privacy. |
| 2 | Your Privacy Matters | All conversations stay on your device. No data is sent to any server. |
| 3 | Works Offline | Once you download a model, it works without internet. |
| 4 | Choose Your Model | Smaller models are faster, larger models are smarter. We'll help you pick. |

#### 9.1.3 First Model Download

**Trigger:** Onboarding complete, no models downloaded.

**Steps:**
1. `ModelDownloadScreen` shows recommended models filtered by device RAM
2. Each card shows: model name, parameter count, size estimate, description
3. User selects a model → download begins
4. Progress bar shows percentage + bytes
5. On completion → navigate to `MainTabs` (Home)
6. User can also tap "Skip" → goes to Home with no model (shows "download a model" prompt)

**Recommendations by RAM:**

| Device RAM | Max Parameters | Suggested Quantization |
|-----------|---------------|----------------------|
| 3–4 GB | 1.5B | Q4_K_M |
| 4–6 GB | 3B | Q4_K_M |
| 6–8 GB | 4B | Q4_K_M |
| 8–12 GB | 8B | Q4_K_M |
| 12–16 GB | 13B | Q4_K_M |
| 16+ GB | 30B | Q4_K_M |

---

### 9.2 Authentication & Security

#### 9.2.1 Passphrase Setup

**Trigger:** Settings → Security → Enable Passphrase.

**Steps:**
1. Navigate to `PassphraseSetupScreen`
2. Enter passphrase (first field)
3. Confirm passphrase (second field)
4. Validation: entries must match
5. On mismatch → error message, fields cleared
6. On match → `authService.setPassphrase(hash)` → stored in Keychain
7. `authStore.setEnabled(true)`
8. Navigate back to Settings

**Service:** AuthService (hashes with 1000 iteration rounds, stores in Keychain)

#### 9.2.2 App Lock Trigger

**Trigger:** App goes to background while auth is enabled.

**Steps:**
1. `useAppState` hook detects `AppState → background`
2. `authStore.lastBackgroundTime` set to `Date.now()`
3. When app returns to foreground:
   - Check if enough time has passed (immediate lock currently)
   - `authStore.setLocked(true)`
   - `LockScreen` renders over entire app

#### 9.2.3 Unlock Flow

**Trigger:** User enters passphrase on LockScreen.

**Steps:**
1. Check lockout: if `lockoutUntil > now` → show countdown timer (MM:SS), input disabled
2. User enters passphrase → `authService.verifyPassphrase(input)`
3. **Correct:** `authStore.setLocked(false)`, `resetFailedAttempts()` → app unlocks
4. **Incorrect:** `authStore.recordFailedAttempt()`
   - `failedAttempts++`
   - If `failedAttempts >= 5` → `lockoutUntil = now + 5 minutes`
   - Show error + remaining attempts count
5. Lockout persists across app restart (lockoutUntil is persisted)

---

### 9.3 Model Browsing & Download

#### 9.3.1 Browse Text Models

**Trigger:** Navigate to Models tab.

**Steps:**
1. `ModelsScreen` loads → shows curated recommended models filtered by device RAM
2. Recommended models fetched from HuggingFace API with real metadata (excludes already downloaded)
3. Each `ModelCard` shows: name, author tag, description, credibility badge, action icons
4. User can:
   - **Search**: type query → fetches from HuggingFace API with search term
   - **Filter by organization**: Qwen, Meta, Google, Microsoft, Mistral, DeepSeek, HuggingFace, NVIDIA
   - **Filter by size**: tiny (<1B), small (1-3B), medium (3-8B), large (8B+)
   - **Filter by quantization**: Q4_K_M, Q4_K_S, Q5_K_M, Q6_K, Q8_0
   - **Filter by type**: Text, Vision, Code
   - **Filter by credibility**: LM Studio, Official, Verified, Community
   - **Import local model**: Import .gguf files from device storage via file picker
   - **Pull to refresh**: re-fetches from API
   - **Scroll for more**: pagination / infinite scroll

**Filter UI:**
- Filter pills with expandable sections for multi-select options
- Active filter indicator dot on filter toggle button
- Clear all filters button
- Filters persist within the session

**Credibility badges:**
| Badge | Color | Meaning |
|-------|-------|---------|
| LM Studio | Cyan (#22D3EE) | Official LM Studio quantization — highest quality GGUF |
| Official | Green (#22C55E) | From the original model creator (Meta, Microsoft, Qwen, etc.) |
| Verified | Purple (#A78BFA) | From trusted quantizers (TheBloke, bartowski, etc.) |
| Community | Gray (#64748B) | Community contributed |

#### 9.3.2 View Model Files

**Trigger:** Tap a model card to expand.

**Steps:**
1. Calls `huggingFaceService.getModelFiles(modelId)`
2. Uses HF tree API (preferred) with fallback to siblings array
3. Filters for `.gguf` files only
4. Sorts by size (ascending)
5. Displays for each file: filename, quantization level (e.g., Q4_K_M), size (GB/MB)
6. For vision models: auto-pairs mmproj companion file with matching quantization
7. Shows quantization quality indicator (Low → Excellent)

#### 9.3.3 Download Text Model (Background — Both Platforms)

**Trigger:** Tap download button on a model file.

**Steps:**
1. Construct download URL: `https://huggingface.co/{modelId}/resolve/main/{fileName}`
2. First download triggers notification permission rationale dialog (if not yet granted)
3. `backgroundDownloadService.startDownload(url, fileName)` enqueues in native download manager
4. **Android:** System DownloadManager with SharedPreferences tracking, 500ms polling for progress
5. **iOS:** Background URLSession with delegate-based progress callbacks
6. UI shows: progress bar, percentage, bytes downloaded / total
7. File saved to `Documents/local-llm/models/{fileName}`
8. If vision model: mmproj file downloaded **in parallel** alongside main model
9. On completion:
   - File moved from temp location to models directory
   - Create `DownloadedModel` metadata object
   - Save to `appStore.downloadedModels[]`
   - Persist metadata to AsyncStorage
10. Model appears in "Downloaded" section and model selector

**Cancellation:** User taps cancel → download cancelled → partial file cleaned up

**Recovery after app kill:** On next launch, `restore.ts` recovers download state from native storage (SharedPreferences on Android, URLSession on iOS)

**States:** pending → running → paused → completed / failed

#### 9.3.4 Import Local Model (Bring Your Own Model)

**Trigger:** Tap "Import local .gguf" button on Models screen.

**Steps:**
1. Native file picker opens via `@react-native-documents/picker` (filtered to all files)
2. User selects a `.gguf` file from device storage
3. Validation: file must have `.gguf` extension
4. On Android: if URI is `content://`, file is first copied to app cache directory
5. File size determined, duplicate check against existing downloaded models
6. File copied to `Documents/local-llm/models/{fileName}` with progress tracking (500ms polling)
7. Model name and quantization parsed from filename (e.g., `qwen3-3b-q4_k_m.gguf` → name: "qwen3-3b", quant: "Q4_K_M")
8. `DownloadedModel` metadata created with `source: 'local-import'`
9. Saved to `appStore.downloadedModels[]`
10. Model appears in model selector, ready to load

**Error handling:**
- Non-GGUF files → error alert
- Duplicate model → error alert with existing model name
- Copy failure → cleanup partial file, error alert

**Implementation:** `modelManager.importLocalModel()` in `src/services/modelManager.ts`

#### 9.3.5 Download Image Model

**Trigger:** Tap download on an image model card.

**Steps:**
1. Download archive (`.zip`) containing model components
2. Extract via `react-native-zip-archive`
3. Components: CLIP text encoder, UNet, VAE decoder, tokenizer JSON
4. Stored in `Documents/image_models/{modelName}/`
5. Create `ONNXImageModel` metadata with detected backend (mnn/qnn) and style
6. Save to `appStore.downloadedImageModels[]`

#### 9.3.6 Delete Model

**Trigger:** Long-press model in Downloaded section → Delete, or from Storage Settings.

**Steps:**
1. Show confirmation dialog ("This will permanently delete the model file")
2. If model is currently loaded → warn that it will be unloaded first
3. `activeModelService.unloadTextModel()` if needed
4. `RNFS.unlink(filePath)` → delete from disk
5. If vision model: also delete mmproj file
6. Remove from `appStore.downloadedModels[]`
7. Update AsyncStorage

---

### 9.4 Model Loading & Memory

#### 9.4.1 Load Text Model

**Trigger:** Tap model in selector, or auto-load on chat entry if `activeModelId` set.

**Steps:**
1. Check memory budget: `estimatedMemory = fileSize * 1.5`
2. If exceeds 60% of device RAM → show warning, possibly refuse
3. If another model loaded → unload first (free context, clear KV cache)
4. `llmService.initContext()` with parameters:
   - `model`: file path
   - `n_ctx`: from settings (default 2048)
   - `n_threads`: platform default
   - `n_batch`: 256
   - `n_gpu_layers`: iOS Metal = 99, Android = 0
   - Optional: `mmproj` path for vision models
5. UI shows loading indicator
6. On success:
   - `appStore.setActiveModelId(id)`
   - Detect multimodal support (`initMultimodal()`)
   - Show "Model loaded" system message in chat
   - Display load time
7. On failure:
   - OOM → suggest smaller model
   - Corrupt file → suggest re-download
   - Unknown error → show error + retry option

#### 9.4.2 Unload Text Model

**Trigger:** Explicit unload from UI, or automatic before loading different model.

**Steps:**
1. If generation in progress → stop it first
2. `llmService.releaseContext()` → frees native memory
3. Clear KV cache
4. `appStore.setActiveModelId(null)`
5. Show "Model unloaded" system message
6. Display freed memory estimate

#### 9.4.3 Load Image Model

**Trigger:** Image generation requested, or manual load from model selector.

**Steps:**
1. Memory check: `estimatedMemory = modelSize * 1.8`
2. `LocalDreamModule.loadModel(modelPath)` → starts subprocess
3. Subprocess loads CLIP, UNet, VAE components
4. Detects backend (MNN vs QNN based on file extensions)
5. If QNN model on non-Qualcomm device → falls back to MNN
6. `appStore.setActiveImageModelId(id)`

#### 9.4.4 Model Loading Strategies

**Performance mode (`'performance'`):**
- Model stays loaded in RAM across generations
- Faster response times (no load latency between messages)
- Higher memory usage
- Session caching works optimally
- Intent classifier can swap to classifier model and swap back

**Memory mode (`'memory'`):**
- Model loaded on demand before each generation
- Unloaded after generation completes
- Lower peak memory usage
- Slower (load time added to each generation)
- Suitable for devices with < 6GB RAM

---

### 9.5 Text Generation

#### 9.5.1 Send Message & Generate Response

**Trigger:** User types message and taps Send.

**Steps:**
1. Validate: message not empty/whitespace-only, model loaded
2. Create `Message` object with `role: 'user'`, add to conversation via `chatStore.addMessage()`
3. Clear input field
4. **Intent classification** (if image mode is 'auto'):
   - Run pattern matching on message text
   - If uncertain and `autoDetectMethod === 'llm'`: classify via LLM
   - If intent is 'image' → route to image generation (see 9.6)
5. Build message context:
   - System prompt (from project if linked, else from settings)
   - Conversation history (truncated to fit context window at 85% utilization)
   - Current user message
6. `generationService.startGeneration()` → `llmService.completion()`
7. **Streaming phase:**
   - `chatStore.setStreaming(true)`
   - Tokens arrive via callback → `chatStore.updateStreamingMessage(token)`
   - `<think>` tags detected → `isThinking = true` (content shown in collapsible block)
   - UI auto-scrolls to follow new tokens
   - Stop button appears
8. **Completion:**
   - Final message saved to conversation with `generationMeta`:
     - `tokensPerSecond`, `decodeTokensPerSecond`, `timeToFirstToken`, `tokenCount`
     - `gpu` (boolean), `gpuBackend`, `gpuLayers`
     - `kvCacheType`, `flashAttention`
     - `modelName`
   - `generationTimeMs` recorded
   - `chatStore.setStreaming(false)`
   - Conversation `updatedAt` timestamp updated
   - If tool calling enabled and model supports it, enters tool loop (see Tool Calling Services)

#### 9.5.2 Stop Generation

**Trigger:** User taps Stop button during streaming.

**Steps:**
1. `llmService.stopCompletion()` → signals native to stop
2. Current partial response is kept (not discarded)
3. Message finalized with partial content + metadata
4. Streaming state cleared
5. User can send new message immediately

#### 9.5.3 Retry Generation

**Trigger:** User taps retry on an assistant message.

**Steps:**
1. Delete the assistant message being retried
2. Re-send the preceding user message through the generation pipeline
3. New response streams in to replace the old one

#### 9.5.4 Context Window Management

**How it works:**
1. Before each generation, tokenize the full context (system + history + current)
2. If token count exceeds `contextLength * 0.85`:
   - Drop oldest messages (keeping system prompt + most recent messages)
   - Re-tokenize to verify fit
3. If KV cache is full → clear cache and rebuild context
4. Safety margin prevents overflows that would crash native inference

#### 9.5.5 Thinking Blocks

**Trigger:** Model outputs `<think>...</think>` tags.

**Behavior:**
1. Parser detects `<think>` opening tag
2. `isThinking` flag set on streaming message
3. Content inside tags rendered in a collapsible/dimmed block
4. `</think>` tag detected → `isThinking = false`
5. Content after closing tag rendered normally
6. Final message preserves thinking content (viewable on expand)

#### 9.5.6 Generation Metadata Display

When `showGenerationDetails` is enabled in settings:

| Metric | Source | Display |
|--------|--------|---------|
| Tokens/sec (overall) | `tokensPerSecond` | "12.3 tok/s" |
| Tokens/sec (decode) | `decodeTokensPerSecond` | "15.1 tok/s decode" |
| Time to first token | `timeToFirstToken` | "0.8s TTFT" |
| Total tokens | `tokenCount` | "342 tokens" |
| GPU used | `gpu` + `gpuBackend` | "Metal" or "CPU" |
| GPU layers | `gpuLayers` | "99 layers" |
| Model name | `modelName` | "Qwen2.5-3B-Q4_K_M" |
| Generation time | `generationTimeMs` | "28.4s" |

---

### 9.6 Image Generation

#### 9.6.1 Auto-Triggered Image Generation

**Trigger:** User sends message that intent classifier routes to image generation.

**Steps:**
1. Intent classified as 'image' (see 9.5.1 step 4)
2. Check: image model loaded?
   - No → attempt to load `activeImageModelId`
   - Still no → show "No image model" error
3. Create user message in conversation
4. `imageGenerationService.generate()` with params:
   - `prompt`: user's message
   - `negativePrompt`: from settings (if configured)
   - `steps`: from settings (default varies by model)
   - `guidanceScale`: from settings
   - `width`, `height`: from settings
   - `seed`: random (or specified)
5. **Progress phase:**
   - Native module emits `LocalDreamProgress` events
   - UI shows: step counter ("Step 5/20"), progress bar, preview thumbnail
   - Preview images update every few steps (base64 → PNG → display)
6. **Completion:**
   - Final RGB data received as base64
   - Saved as PNG via `LocalDreamModule.saveRgbAsPng()`
   - `GeneratedImage` created with full metadata
   - Added to `appStore.generatedImages[]`
   - Assistant message added to conversation with image attachment
   - Generation meta includes: steps, guidanceScale, resolution, seed

#### 9.6.2 Manual/Forced Image Generation

**Trigger:** User toggles image mode to "Force" in chat input, then sends any message.

**Steps:**
1. Image mode toggle in `ChatInput` → `ImageModeState = 'force'`
2. Visual indicator shows image mode is active
3. Any message sent bypasses intent classification → routes directly to image generation
4. Same pipeline as 9.6.1 from step 2 onward

#### 9.6.3 Cancel Image Generation

**Trigger:** User taps Stop during image generation progress.

**Steps:**
1. `imageGenerationService.cancel()` → `LocalDreamModule.cancelGeneration()`
2. Current partial image may be available (from preview)
3. Generation state cleared
4. No image added to gallery or conversation

#### 9.6.4 Image Generation Parameters

| Parameter | Range | Default | Effect |
|-----------|-------|---------|--------|
| Steps | 1–50 | Model-dependent | More steps = higher quality, slower |
| Guidance Scale | 1.0–20.0 | 7.5 | Higher = stricter prompt following |
| Width | 128–512 (multiples of 64) | 512 | Image width in pixels |
| Height | 128–512 (multiples of 64) | 512 | Image height in pixels |
| Negative Prompt | Free text | Empty | What to exclude from generation |
| Seed | Integer | Random | Reproducibility (same seed = same image) |

#### 9.6.5 Backend Selection

| Backend | Hardware | Speed | Quality | Detection |
|---------|----------|-------|---------|-----------|
| MNN (CPU) | All Android | Slower | Good | Default fallback |
| QNN (NPU) | Qualcomm Snapdragon (SM/QCS/QCM) | 3-5x faster | Same | Auto-detected via `isNpuSupported()` |

Auto-selection: If QNN model downloaded and device supports QNN → use QNN. Otherwise → MNN.

---

### 9.7 Vision Models (Image Understanding)

#### 9.7.1 Load Vision Model

**Trigger:** Select a vision-capable model (has mmproj companion file).

**Steps:**
1. Same loading flow as 9.4.1
2. Additionally: `llmService.initContext()` receives `mmproj` path
3. `initMultimodal()` called → enables image input processing
4. Vision capability indicator shown in UI

#### 9.7.2 Send Image for Analysis

**Trigger:** User attaches image (camera or gallery) + sends message.

**Steps:**
1. Tap attachment button → choose Camera or Gallery
2. Image selected → `MediaAttachment` created with `type: 'image'`
3. Thumbnail shown in input area
4. User types prompt (e.g., "What's in this image?") + sends
5. Message created with `attachments` array containing the image
6. Image passed to llama.rn context alongside text
7. Vision encoder (mmproj) processes the image
8. Text model generates response about the image
9. Response streams normally with metadata

#### 9.7.3 Document Attachment

**Trigger:** User attaches a document (.txt, .py, .js, etc.).

**Steps:**
1. Tap attachment button → choose Document
2. `documentService.extractText(uri)` → extracts text content
3. `MediaAttachment` created with `type: 'document'`, `textContent` populated
4. Preview shows filename + text snippet
5. On send: text content included in prompt context
6. Model can reference and analyze document content

---

### 9.8 Voice Input

#### 9.8.1 Voice Recording & Transcription

**Trigger:** Long-press or tap microphone button in ChatInput.

**Steps:**
1. Check microphone permission → request if not granted
2. Check Whisper model availability:
   - Not downloaded → prompt to download (navigate to Voice Settings)
   - Downloaded but not loaded → load model
3. Start recording → `voiceService.startRecording()`
4. UI shows: recording indicator, duration timer, waveform visualization
5. User releases / taps stop → recording ends
6. Audio sent to `whisperService.transcribeRealtime()`:
   - Processes in chunks
   - Partial results update in real-time
   - Final transcription returned
7. Transcribed text inserted into chat input field
8. User can edit before sending

#### 9.8.2 Whisper Model Management

**Trigger:** Voice Settings screen.

**Steps:**
1. List available Whisper models with sizes
2. User selects and downloads a model
3. Download progress shown
4. On completion: model stored in `Documents/whisper-models/`
5. `whisperStore.downloadedModelId` set
6. Model loaded on first transcription request

---

### 9.9 Conversations

#### 9.9.1 Create Conversation

**Trigger:** "New Chat" button on Home or Chats tab.

**Steps:**
1. `chatStore.createConversation()` creates new `Conversation`:
   - Generated UUID
   - Title: "New Conversation" (auto-updated after first message)
   - `modelId`: current `activeModelId`
   - `projectId`: if started from a project
   - Empty `messages[]`
   - Timestamps set
2. Navigate to `ChatScreen` with new conversation

#### 9.9.2 Auto-Generate Title

**Trigger:** First user message sent in a conversation.

**Steps:**
1. After first response completes
2. Title derived from first message content (truncated)
3. `chatStore.updateConversation()` updates title

#### 9.9.3 Switch Conversations

**Trigger:** Tap a conversation in ChatsListScreen.

**Steps:**
1. If generation in progress → warn user (generation will stop)
2. `chatStore.setActiveConversationId(newId)`
3. Navigate to `ChatScreen`
4. Messages loaded from store (already in memory, persisted)
5. Scroll to bottom

#### 9.9.4 Delete Conversation

**Trigger:** Swipe-to-delete or long-press → Delete.

**Steps:**
1. Show confirmation dialog
2. `chatStore.deleteConversation(id)`:
   - Remove from `conversations[]`
   - All messages deleted
3. Associated gallery images remain (not cascade-deleted)
4. If was active conversation → navigate to conversations list

#### 9.9.5 Projects Integration

**Trigger:** Start chat from a project, or select project in chat.

**Steps:**
1. `chatStore.createConversation()` with `projectId` set
2. System prompt from `projectStore.projects[].systemPrompt` used instead of default
3. Project badge shown in chat header and conversation list
4. If project deleted later → conversation keeps its system prompt (snapshot)

---

### 9.10 Gallery

#### 9.10.1 View Gallery

**Trigger:** Navigate to Gallery tab/modal.

**Steps:**
1. Load `appStore.generatedImages[]`
2. Display as 3-column grid, sorted by `createdAt` (most recent first)
3. Each thumbnail loaded from `imagePath` on disk
4. Filter dropdown: "All" or specific conversation

#### 9.10.2 Image Detail View

**Trigger:** Tap an image thumbnail.

**Steps:**
1. Open fullscreen viewer
2. Pinch to zoom, pan to navigate
3. View metadata: prompt, negative prompt, steps, seed, guidance scale, resolution, model, timestamp
4. Actions: Share, Save to Device, Delete

#### 9.10.3 Save to Device

**Trigger:** Tap Save in image viewer.

**Steps:**
1. Copy image to device-accessible location:
   - Android: `Pictures/OffgridMobile/` or `Documents/OffgridMobile_Images/`
   - iOS: Camera Roll (via photo library API)
2. Show success confirmation

#### 9.10.4 Multi-Select & Batch Delete

**Trigger:** Enter selection mode (long-press an image).

**Steps:**
1. Selection mode activated → checkboxes appear on thumbnails
2. Tap to select/deselect individual images
3. "Select All" option available
4. Tap "Delete Selected"
5. Confirmation dialog
6. Delete selected images from disk + remove from `appStore.generatedImages[]`

---

### 9.11 Settings

#### 9.11.1 Text Generation Settings

| Setting | Type | Range | Default | Effect |
|---------|------|-------|---------|--------|
| System Prompt | Text area | Free text | (see APP_CONFIG) | Personality/behavior instructions |
| Temperature | Slider | 0.0 – 2.0 | 0.7 | Randomness (low = deterministic, high = creative) |
| Top-P | Slider | 0.0 – 1.0 | 0.9 | Nucleus sampling threshold |
| Repeat Penalty | Slider | 1.0 – 2.0 | 1.1 | Penalizes token repetition |
| Max Tokens | Input | 1 – 4096+ | 512 | Maximum response length |
| Context Length | Input | 512 – 8192 | 2048 | Conversation history window |
| Threads | Slider | 1 – device max | 4 (iOS) / 6 (Android) | CPU threads for inference |
| Batch Size | Input | 1 – 512 | 256 | Token processing batch |
| GPU | Toggle | On/Off | iOS: On, Android: Off | GPU acceleration |
| GPU Layers | Slider | 0 – 99 | iOS: 99, Android: 0 | Layers offloaded to GPU |
| Loading Strategy | Toggle | Performance / Memory | Performance | Keep model loaded vs load-on-demand |
| Show Details | Toggle | On/Off | Off | Show generation metadata on messages |

#### 9.11.2 Image Generation Settings

| Setting | Type | Range | Default |
|---------|------|-------|---------|
| Steps | Slider | 1 – 50 | Model-dependent |
| Guidance Scale | Slider | 1.0 – 20.0 | 7.5 |
| Width | Input | 128 – 512 | 512 |
| Height | Input | 128 – 512 | 512 |
| Threads | Slider | 1 – device max | Platform default |

#### 9.11.3 Intent Detection Settings

| Setting | Options | Effect |
|---------|---------|--------|
| Image Generation Mode | Auto / Manual | Auto detects intent; Manual requires explicit toggle |
| Auto-Detect Method | Pattern / LLM | Pattern-only (fast) vs Pattern + LLM fallback (accurate) |
| Classifier Model | (model selector) | Which model to use for LLM classification |

**All settings auto-save on change (no save button needed) and persist across app restarts.**

---

### 9.12 App Lifecycle

#### 9.12.1 Background / Foreground

**Trigger:** User switches apps, locks phone, or presses home button.

**Going to background:**
1. `useAppState` detects `AppState → background`
2. `authStore.lastBackgroundTime` recorded
3. Generation services continue (lifecycle-independent)
4. Background downloads continue (Android)

**Returning to foreground:**
1. `useAppState` detects `AppState → active`
2. If auth enabled → `authStore.setLocked(true)` → show `LockScreen`
3. Refresh device info (available memory may have changed)
4. If generation completed while backgrounded → messages already in store

#### 9.12.2 Force Kill & Recovery

**Trigger:** User swipes away app or system kills it.

**Recovery on next launch:**
1. All Zustand persisted stores rehydrated from AsyncStorage
2. Conversations, messages, settings all restored
3. Active model ID remembered (but model not loaded — needs re-load)
4. Background downloads (Android): synced from SharedPreferences
5. Streaming state cleared (was not persisted)
6. Any partial generation is lost (the streaming message was not saved)

#### 9.12.3 Generation During Background

**Text generation:** Continues via `generationService` (lifecycle-independent). When user returns, streaming message and final result are in the store.

**Image generation:** Continues via `imageGenerationService`. Progress events accumulate. When user returns to chat, they see current progress or completed image.

**Background downloads (Android):** Android DownloadManager continues independently. On next app open, `syncBackgroundDownloads()` queries system for status.

---

### 9.13 Intent Classification — Detailed

The intent classifier determines whether a user's message should trigger text generation or image generation.

#### Classification Pipeline

```
User message
    │
    ▼
[1] Quick checks ─────────────────────────────────────────┐
    │ • Message < 10 chars → TEXT                         │
    │ • Multiple sentences → TEXT                          │
    │ • Exact code/question keywords → TEXT                │
    │                                                      │
    ▼                                                      │
[2] Image pattern matching ────────────────────────────────┤
    │ • 45+ patterns: "draw", "generate image",           │
    │   "paint", art styles, DALL-E, negative prompt,     │
    │   resolution specifications                          │
    │ • Match found → IMAGE                               │
    │                                                      │
    ▼                                                      │
[3] Text pattern matching ─────────────────────────────────┤
    │ • 40+ patterns: questions, code, math, analysis,    │
    │   explanation, help requests                         │
    │ • Match found → TEXT                                │
    │                                                      │
    ▼                                                      │
[4] Ambiguous — check autoDetectMethod ────────────────────┤
    │                                                      │
    ├── 'pattern' mode → default TEXT                      │
    │                                                      │
    └── 'llm' mode → [5] LLM Classification               │
                          │                                │
                          ▼                                │
                    Prompt: "Is this asking to             │
                    create/generate/draw an image?"        │
                          │                                │
                          ├── "yes" → IMAGE                │
                          ├── "no" → TEXT                  │
                          └── error → TEXT (fallback)      │
                                                           │
                    Result cached (max 100 entries) ◄──────┘
```

#### Example Classifications

| Input | Classification | Stage | Reason |
|-------|---------------|-------|--------|
| "Hi" | TEXT | Quick check | < 10 chars |
| "Draw a cat" | IMAGE | Image patterns | Matches "draw" |
| "What is Python?" | TEXT | Text patterns | Matches "what is" |
| "A beautiful sunset over mountains" | TEXT (pattern) or IMAGE (LLM) | Ambiguous | No clear pattern; LLM may classify as image |
| "Generate an oil painting of a forest" | IMAGE | Image patterns | Matches "generate" + "oil painting" |
| "Write a function to sort an array" | TEXT | Text patterns | Matches "write a function" |

---

### 9.14 Error Handling

#### Network Errors

| Scenario | Handling |
|----------|---------|
| No internet during model browse | Error message + "Retry" button |
| Network drop during download (foreground) | Error + "Resume" option (HTTP range requests) |
| Network drop during download (background) | Android DownloadManager pauses; resumes when network returns |
| HuggingFace API timeout | Timeout error + retry |

#### Model Errors

| Scenario | Handling |
|----------|---------|
| Corrupt model file | Detection on load → error + "Delete and re-download" suggestion |
| OOM during model load | Error + "Try a smaller model" suggestion |
| Model file deleted externally | Detected during sync → removed from list |
| Incompatible model version | Error message during load |

#### Generation Errors

| Scenario | Handling |
|----------|---------|
| OOM during text generation | Error message + suggest reducing context length |
| Native crash during generation | Graceful error message, generation state cleared |
| Image generation failure | Error message, no image added |
| No model loaded when sending | Prompt to load a model |

#### Storage Errors

| Scenario | Handling |
|----------|---------|
| Insufficient storage before download | Pre-check + error with space requirements |
| Storage full mid-download | Download fails gracefully, partial file cleaned up |
| File system permission denied | Error message |

---

## 10. Testing Infrastructure

### Unit Tests (`__tests__/unit/`)

| Test File | Covers |
|-----------|--------|
| `stores/appStore.test.ts` | App store state transitions |
| `stores/chatStore.test.ts` | Conversation CRUD, message management |
| `stores/authStore.test.ts` | Auth state, lockout logic |
| `stores/projectStore.test.ts` | Project CRUD |
| `stores/whisperStore.test.ts` | Whisper model state |
| `services/generationService.test.ts` | Text generation lifecycle |
| `services/generationToolLoop.test.ts` | Tool loop orchestration |
| `services/intentClassifier.test.ts` | Pattern matching, LLM fallback |
| `services/llm.test.ts` | Model loading, GPU fallback, generation, context |
| `services/llmMessages.test.ts` | Message building/formatting |
| `services/llmToolGeneration.test.ts` | Tool-aware LLM generation |
| `services/hardware.test.ts` | Device info, memory calculations, recommendations |
| `services/modelManager.test.ts` | Download lifecycle, storage, orphan detection |
| `services/downloadHelpers.test.ts` | Download helper utilities |
| `services/restore.test.ts` | Download restore after app kill |
| `services/parallelMmproj.test.ts` | Parallel mmproj download |
| `services/backgroundDownloadService.test.ts` | Native events, polling lifecycle |
| `services/localDreamGenerator.test.ts` | Platform routing, iOS/Android delegation |
| `services/imageGenerator.test.ts` | Image generator helper |
| `services/imageModelRecommendation.test.ts` | Image model recommendations |
| `services/coreMLModelBrowser.test.ts` | Model discovery, caching, errors |
| `services/huggingFaceModelBrowser.test.ts` | Image model browsing |
| `services/whisperService.test.ts` | Transcription, permissions |
| `services/voiceService.test.ts` | Voice input bridge |
| `services/documentService.test.ts` | File types, reading, preview |
| `services/pdfExtractor.test.ts` | PDF text extraction |
| `services/huggingface.test.ts` | HuggingFace API client |
| `services/authService.test.ts` | Auth service |
| `tools/handlers.test.ts` | Tool execution handlers |
| `tools/registry.test.ts` | Tool definitions & schema |
| `hooks/useAppState.test.ts` | App state foreground/background |
| `hooks/useChatGenerationActions.test.ts` | Chat generation actions |
| `hooks/useChatModelActions.test.ts` | Chat model actions |
| `hooks/useNotifRationale.test.ts` | Notification rationale |
| `hooks/useVoiceRecording.test.ts` | Voice recording state machine |
| `hooks/useWhisperTranscription.test.ts` | Whisper transcription |
| `onboarding/checklistComponents.test.tsx` | Checklist ProgressBar, animations |
| `onboarding/onboardingFlows.test.ts` | Onboarding flow logic |
| `onboarding/spotlightTooltips.test.ts` | Spotlight tooltip rendering |
| `onboarding/handleStepPress.test.ts` | Step press navigation |
| `onboarding/chatScreenSpotlight.test.ts` | Chat screen spotlight behavior |
| `onboarding/reactiveSpotlightConditions.test.ts` | Reactive spotlight conditions |
| `constants/constants.test.ts` | Constants validation |
| `theme/palettes.test.ts` | Theme palette definitions |
| `utils/coreMLModelUtils.test.ts` | Core ML model path utilities |
| `utils/messageContent.test.ts` | Message content utilities |
| `screens/ModelsScreen/imageDownloadActions.test.ts` | Image download actions |
| `screens/ModelsScreen/restoreImageDownloads.test.ts` | Image download restore |
| `screens/ModelsScreen/utils.test.ts` | ModelsScreen utilities |

### Integration Tests (`__tests__/integration/`)

| Test File | Covers |
|-----------|--------|
| `stores/chatStoreIntegration.test.ts` | Multi-store interactions |
| `models/activeModelService.test.ts` | Model load/unload with memory checks |
| `generation/generationFlow.test.ts` | End-to-end text generation |
| `generation/imageGenerationFlow.test.ts` | End-to-end image generation |
| `onboarding/spotlightFlowIntegration.test.ts` | End-to-end spotlight behavior |

### Contract Tests (`__tests__/contracts/`)

Tests that verify native module interfaces haven't changed:

| Test File | Native Module |
|-----------|---------------|
| `llama.rn.test.ts` | llama.rn API shape |
| `whisper.rn.test.ts` | whisper.rn API shape |
| `whisper.contract.test.ts` | Whisper service contracts |
| `localDream.contract.test.ts` | LocalDream module contracts |
| `llamaContext.contract.test.ts` | LlamaContext lifecycle |
| `coreMLDiffusion.contract.test.ts` | iOS Core ML parity |
| `iosDownloadManager.contract.test.ts` | iOS download parity |

### Component Tests (`__tests__/rntl/`)

React Native Testing Library tests:

**Screens (19 files):**
- `ChatScreen.test.tsx`, `ChatsListScreen.test.tsx`, `DeviceInfoScreen.test.tsx`
- `DownloadManagerScreen.test.tsx`, `GalleryScreen.test.tsx`, `HomeScreen.test.tsx`
- `LockScreen.test.tsx`, `ModelDownloadScreen.test.tsx`, `ModelSettingsScreen.test.tsx`
- `ModelsScreen.test.tsx`, `OnboardingScreen.test.tsx`, `PassphraseSetupScreen.test.tsx`
- `ProjectDetailScreen.test.tsx`, `ProjectEditScreen.test.tsx`, `ProjectsScreen.test.tsx`
- `SecuritySettingsScreen.test.tsx`, `SettingsScreen.test.tsx`, `StorageSettingsScreen.test.tsx`
- `VoiceSettingsScreen.test.tsx`

**Components (17 files):**
- `ChatInput.test.tsx`, `ChatMessage.test.tsx`, `ChatMessageTools.test.tsx`
- `AnimatedEntry.test.tsx`, `AnimatedListItem.test.tsx`, `AnimatedPressable.test.tsx`
- `AppSheet.test.tsx`, `Card.test.tsx`, `CustomAlert.test.tsx`, `DebugSheet.test.tsx`
- `GenerationSettingsModal.test.tsx`, `MarkdownText.test.tsx`
- `ModelCard.test.tsx`, `ModelSelectorModal.test.tsx`
- `ProjectSelectorSheet.test.tsx`, `ToolPickerSheet.test.tsx`, `VoiceRecordButton.test.tsx`

**Onboarding/Spotlight (5 files):**
- `ChatScreenSpotlight.test.tsx`, `ChatsListScreenSpotlight.test.tsx`
- `HomeScreenSpotlight.test.tsx`, `ModelSettingsScreenSpotlight.test.tsx`
- `ProjectEditScreenSpotlight.test.tsx`

**Other:**
- `navigation/AppNavigator.test.tsx`
- `hooks/useFocusTrigger.test.ts`

**Test commands:**
```bash
npm run test              # Jest unit/integration/contract tests
```

---

## 11. Constants & Configuration

### Model Recommendations by RAM

| Device RAM | Max Model Parameters | Recommended Quantization |
|-----------|---------------------|-------------------------|
| 3–4 GB | 1.5B | Q4_K_M |
| 4–6 GB | 3B | Q4_K_M |
| 6–8 GB | 4B | Q4_K_M |
| 8–12 GB | 8B | Q4_K_M |
| 12–16 GB | 13B | Q4_K_M |
| 16+ GB | 30B | Q4_K_M |

### Recommended Models (Mar 2026)

| Model | Parameters | Min RAM | Type | Description |
|-------|-----------|---------|------|-------------|
| Qwen 3 0.6B | 0.6B | 3 GB | Text | Latest Qwen with thinking mode, ultra-light |
| Gemma 3 1B | 1B | 3 GB | Text | Google's tiny model, 128K context |
| Llama 3.2 1B | 1B | 4 GB | Text | Meta's fastest mobile model, 128K context |
| Gemma 3n E2B | 2B | 4 GB | Text | Google's mobile-first with selective activation |
| Llama 3.2 3B | 3B | 6 GB | Text | Best quality-to-size ratio for mobile |
| SmolLM3 3B | 3B | 6 GB | Text | Strong reasoning & 128K context |
| Phi-4 Mini | 3.8B | 6 GB | Text | Math & reasoning specialist |
| Qwen 3 8B | 8B | 8 GB | Text | Thinking + non-thinking modes, 100+ languages |
| Qwen 3 VL 2B | 2B | 4 GB | Vision | Compact vision-language with thinking mode |
| Gemma 3n E4B | 4B | 6 GB | Vision | Vision + audio, built for mobile |
| Qwen 3 VL 8B | 8B | 8 GB | Vision | Vision-language with thinking mode |
| Qwen 3 Coder A3B | 3B | 6 GB | Code | MoE coding model, only 3B active params |

### Organization Filters

The Models screen supports filtering by model organization:

| Key | Label |
|-----|-------|
| `Qwen` | Qwen |
| `meta-llama` | Llama |
| `google` | Google |
| `microsoft` | Microsoft |
| `mistralai` | Mistral |
| `deepseek-ai` | DeepSeek |
| `HuggingFaceTB` | HuggingFace |
| `nvidia` | NVIDIA |

Defined in `MODEL_ORGS` constant (`src/constants/index.ts`).

### Quantization Quality Ladder

| Quantization | Bits/Weight | Quality | Recommended | Notes |
|-------------|-------------|---------|-------------|-------|
| Q2_K | 2.625 | Low | No | Extreme compression, noticeable quality loss |
| Q3_K_S | 3.4375 | Low-Medium | No | High compression, some quality loss |
| Q3_K_M | 3.4375 | Medium | No | Good compression with acceptable quality |
| Q4_0 | 4.0 | Medium | No | Basic 4-bit quantization |
| Q4_K_S | 4.5 | Medium-Good | Yes | Good balance of size and quality |
| **Q4_K_M** | **4.5** | **Good** | **Yes** | **Optimal for mobile — best balance** |
| Q5_K_S | 5.5 | Good-High | No | Higher quality, larger size |
| Q5_K_M | 5.5 | High | No | Near original quality |
| Q6_K | 6.5 | Very High | No | Minimal quality loss |
| Q8_0 | 8.0 | Excellent | No | Best quality, largest size |

### Theme System

The app supports **light and dark modes** via a dynamic theme system in `src/theme/`. Colors and shadows are no longer hardcoded — all screens and components use `useTheme()` and `useThemedStyles()` hooks.

**Architecture:**
- `src/theme/palettes.ts` — Light and dark color palettes, shadow definitions, elevation factory
- `src/theme/index.ts` — `useTheme()` hook (returns `{ colors, shadows, elevation, isDark }`), `getTheme(mode)` for non-hook contexts
- `src/theme/useThemedStyles.ts` — `useThemedStyles(createStyles)` memoized style factory
- Theme preference stored in `appStore.themeMode` (persisted via Zustand + AsyncStorage)
- Toggle in Settings screen (Dark Mode switch)

**Pattern (every screen/component):**
```typescript
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';

const MyScreen = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return <View style={styles.container}><Icon color={colors.text} /></View>;
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: { backgroundColor: colors.background, ...shadows.small },
});
```

**Theme-independent tokens** (`TYPOGRAPHY`, `SPACING`, `FONTS`) remain in `src/constants/index.ts`.

### Color Palettes

#### Dark Mode (default)
| Token | Hex | Usage |
|-------|-----|-------|
| primary | #34D399 | Emerald accent, active states |
| background | #0A0A0A | Main background (pure black) |
| surface | #141414 | Cards, elevated elements |
| text | #FFFFFF | Primary text |
| textSecondary | #B0B0B0 | Secondary text |
| textMuted | #808080 | Metadata, placeholders |
| border | #1E1E1E | Default borders |
| error | #EF4444 | Error states |

#### Light Mode
| Token | Hex | Usage |
|-------|-----|-------|
| primary | #059669 | Emerald accent (darker for contrast) |
| background | #FFFFFF | Main background (white) |
| surface | #F5F5F5 | Cards, elevated elements |
| text | #0A0A0A | Primary text (near black) |
| textSecondary | #525252 | Secondary text |
| textMuted | #8A8A8A | Metadata, placeholders |
| border | #E5E5E5 | Default borders |
| error | #DC2626 | Error states |

### Shadows

Shadows adapt per theme for proper visibility:
- **Light mode**: Standard black shadows (opacity 0.15–0.35, radius 6–18)
- **Dark mode**: Tight white glow (opacity 0.08–0.12, radius 1–3) for crisp edge definition without blur

---

## 12. File System Layout (On-Device)

```
Documents/
├── local-llm/
│   └── models/                    # Text LLM models (GGUF)
│       ├── qwen2.5-3b-q4_k_m.gguf
│       ├── qwen2.5-3b-q4_k_m-mmproj-f16.gguf   # Vision companion
│       └── ...
│
├── image_models/                  # Stable Diffusion models
│   └── {model-name}/
│       ├── clip_text_encoder.mnn  # (or .bin for QNN)
│       ├── unet.mnn
│       ├── vae_decoder.mnn
│       └── tokenizer.json
│
├── whisper-models/                # Whisper STT models
│   ├── ggml-tiny.en.bin
│   └── ...
│
└── OffgridMobile_Images/               # User-saved generated images
    └── ...

Caches/
└── llm-sessions/                  # LLM session KV cache files
    └── ...

Files/
└── generated_images/              # Generated image PNGs
    ├── {uuid}.png
    └── ...

Cache/
└── preview/                       # Temp preview images during generation
    └── preview.png
```

**Android-specific:**
```
ExternalFilesDir/
└── Downloads/                     # Temp location for background downloads
    └── (moved to Documents/models/ on completion)

assets/
└── runtime_libs/                  # QNN runtime libraries
    ├── libQnnHtp.so
    └── libQnnSystem.so
```

---

## Appendix: Default System Prompt

```
You are a helpful AI assistant running locally on the user's device. Your responses should be:
- Accurate and factual - never make up information
- Concise but complete - answer the question fully without unnecessary elaboration
- Helpful and friendly - focus on solving the user's actual need
- Honest about limitations - if you don't know something, say so

If asked about yourself, you can mention you're a local AI assistant that prioritizes user privacy.
```

---

## Appendix: Default Projects

| Project | System Prompt Summary |
|---------|----------------------|
| **General Assistant** | Helpful AI assistant (default prompt) |
| **Spanish Learning** | Spanish language tutor with conversation practice |
| **Code Review** | Code reviewer providing constructive feedback |
| **Writing Helper** | Writing assistant for drafting and editing |

---
