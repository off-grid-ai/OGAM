/**
 * An install upgraded from release v0.0.119 keeps working.
 *
 * On a real upgrade the phone already holds what v0.0.119 wrote, and this release reads it with new
 * code: the saved app settings gained keys with no explicit migration (analytics consent, video models,
 * per-model image values, modality backends), the document index (documents.db) gained an
 * `embedding_model` table, and transcription changed while a Whisper model still sits at
 * `whisper-models/ggml-<id>.bin`.
 *
 * Product-correct outcome (the person's view): after the update the app opens on Home, nothing they had
 * is lost and nothing they had stops working. Their Gallery image, their chat with its image, their
 * custom image setting, their project's PDF (a question it answers cites it), their speech-to-text model
 * (it transcribes) are all there. Analytics, which they were never asked about, is off.
 *
 * Seed: every shape below is read from v0.0.119's own code (`git show v0.0.119:<path>`):
 *  - `local-llm-app-storage`: what `persistedAppState` (src/stores/appStore.ts) produced, version 0
 *    (the persist call sets none), with `settings` = v0.0.119's DEFAULT_SETTINGS on iOS plus a custom
 *    Image Steps value;
 *  - `local-llm-chat-storage` (src/stores/chatStore.ts, CHAT_STORAGE_VERSION 2): one chat whose reply is
 *    a generated image, written as saveImageGenerationResult (src/services/imageGenerationResult.ts) did;
 *  - `local-llm-project-storage` (src/stores/projectStore.ts, version 0): the project;
 *  - `@local_llm/downloaded_models` (src/services/modelManager/storage.ts): the GGUF model;
 *  - `local-llm-whisper-storage` (src/stores/whisperStore.ts, version 0): the Whisper model id;
 *  - documents.db and rag.db with the tables src/services/documents/store.ts and
 *    src/services/rag/database.ts created (no `embedding_model`), holding the project PDF as v0.0.119 had
 *    read it: its page, its passages and their vectors. The passages and the map come from the shared
 *    document engine (@offgrid/rag/documents), whose splitter and map are unchanged since before the tag;
 *  - the disk: the model, the kept copy of the PDF (attachments/<id>_<name>), the copied MiniLM model,
 *    the Gallery PNG (generated_images/<id>.png) and the Whisper file.
 *
 * Entry point: the REAL App over that state. Every step after launch is a gesture.
 *
 * Fakes (device boundary only, harness/knowledgeBaseApp + documentEngine + nativeBoundary): llama.rn,
 * whisper.rn, the native PDF reader, op-sqlite (a real SQLite kept in files), the in-memory disk,
 * AsyncStorage, the RAM sensor and the native image decoder.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchProjectChatApp } from '../../harness/knowledgeBaseApp';
import { decodeRenderedImages } from '../../harness/nativeImageLoader';
import type { NativeBoundary } from '../../harness/nativeBoundary';
import type { DocumentEngineBoundary } from '../../harness/documentEngine';

jest.unmock('@react-navigation/native');
jest.mock('react-native-bootsplash', () => ({ hide: jest.fn(async () => {}) }), { virtual: true });
jest.setTimeout(120000);

const MB = 1024 * 1024;
const DOCS = '/docs';
const NOW = Date.parse('2026-10-26T10:00:00.000Z');
const iso = (offsetMs = 0) => new Date(NOW + offsetMs).toISOString();

// ── What v0.0.119 had on the phone ─────────────────────────────────────────────────────────────────

const MODEL_FILE = 'Qwen3-1.7B-Q4_K_M.gguf';
const MODEL = {
  id: 'm',
  name: 'Qwen3 1.7B',
  author: 'unsloth',
  filePath: `${DOCS}/models/${MODEL_FILE}`,
  fileName: MODEL_FILE,
  fileSize: 600 * MB,
  quantization: 'Q4_K_M',
  downloadedAt: iso(-86_400_000),
  origin: { repoId: 'unsloth/Qwen3-1.7B-GGUF', revision: 'main', path: MODEL_FILE },
  engine: 'llama',
};

/** A custom Image Steps value (v0.0.119's default on iOS is MAX_IMAGE_STEPS, 50). */
const CUSTOM_IMAGE_STEPS = 13;

const IMAGE_ID = '6f0d6b1e-2b4a-4c3e-9a51-7d2f0c8e4b11';
const IMAGE_PATH = `${DOCS}/generated_images/${IMAGE_ID}.png`;
const IMAGE_PROMPT = 'a lighthouse at dusk';
const CHAT_ID = 'c0119';
const CHAT_TITLE = 'Lighthouse picture';

const PROJECT_ID = '0b3e2c9a-5d71-4f0e-8c2b-9a1d3e4f5a60';
const PROJECT = 'Epic reading';
const PDF_NAME = 'iliad-notes.pdf';
const KEPT_PDF = `${DOCS}/attachments/k0119_${PDF_NAME}`;
const PDF_TEXT = 'Achilles kills Hector outside the walls of Troy and drags his body behind a chariot.';
const QUESTION = 'Who killed Hector?';
const ANSWER = 'Achilles killed Hector outside the walls of Troy [S1].';

const WHISPER_ID = 'base.en';
const WHISPER_NAME = 'Base';
const WHISPER_FILE = `${DOCS}/whisper-models/ggml-${WHISPER_ID}.bin`;
const SPOKEN = 'remind me to reread book twenty two';

const EMBEDDING_MODEL = 'all-MiniLM-L6-v2-Q8_0.gguf';

/** v0.0.119's DEFAULT_SETTINGS (src/stores/appStore.ts at the tag) on iOS, with one custom value. */
const V0119_SETTINGS = {
  systemPrompt: `You are a helpful AI assistant running locally on the user's device. Your responses should be:
- Accurate and factual - never make up information
- Concise but complete - answer the question fully without unnecessary elaboration
- Helpful and friendly - focus on solving the user's actual need
- Honest about limitations - if you don't know something, say so

If asked about yourself, you can mention you're a local AI assistant that prioritizes user privacy.`,
  temperature: 0.7,
  maxTokens: 1024,
  maxToolCalls: 25,
  topP: 0.9,
  repeatPenalty: 1.1,
  contextLength: 4096,
  nThreads: 0,
  nBatch: 0,
  speculativeDecoding: false,
  speculativeDraftMax: 3,
  imageGenerationMode: 'auto',
  autoDetectMethod: 'pattern',
  classifierModelId: null,
  imageSteps: CUSTOM_IMAGE_STEPS,
  imageGuidanceScale: 7.5,
  imageThreads: 4,
  imageWidth: 512,
  imageHeight: 512,
  imageUseOpenCL: true,
  enhanceImagePrompts: false,
  enableGpu: true,
  inferenceBackend: 'metal',
  gpuLayers: 99,
  flashAttn: true,
  aggressiveModelLoading: false,
  modelLoadingMode: 'balanced',
  cacheType: 'q8_0',
  showGenerationDetails: false,
  voiceTurnMode: 'silence',
  voiceSilenceAfterSpeechMs: 5000,
  voiceSpeakerDrainMs: 2000,
  enabledTools: ['web_search', 'read_url', 'search_knowledge_base'],
  thinkingEnabled: false,
  reasoningBudget: 0,
  liteRTBackend: 'gpu',
  liteRTTemperature: 0.7,
  liteRTTopP: 0.9,
  liteRTMaxTokens: 4096,
};

const GENERATED_IMAGE = {
  id: IMAGE_ID,
  prompt: IMAGE_PROMPT,
  imagePath: IMAGE_PATH,
  width: 512,
  height: 512,
  steps: CUSTOM_IMAGE_STEPS,
  seed: 421337,
  modelId: 'coreml-sd-2-1-palettized',
  createdAt: iso(-3_600_000),
  conversationId: CHAT_ID,
};

/** What v0.0.119's persistedAppState wrote. */
const V0119_APP_STATE = {
  state: {
    showSyncStatusBar: true,
    themeMode: 'system',
    hasCompletedOnboarding: true,
    onboardingChecklist: {
      downloadedModel: true,
      loadedModel: true,
      sentMessage: true,
      triedImageGen: true,
      exploredSettings: true,
      createdProject: true,
    },
    checklistDismissed: true,
    activeModelId: MODEL.id,
    lastTextModelId: MODEL.id,
    settings: V0119_SETTINGS,
    modelSettingProvenance: {},
    activeImageModelId: null,
    generatedImages: [GENERATED_IMAGE],
    warmedImageModels: [GENERATED_IMAGE.modelId],
    textGenerationCount: 7,
    imageGenerationCount: 1,
    hasEngagedSharePrompt: false,
    speedBenchmarkBackend: null,
    hasRegisteredPro: false,
    proDeviceAdmission: 'unknown',
    devProDisabled: false,
    proBannerDismissed: false,
    desktopPromoDismissed: false,
    proAhaTriggeredBy: null,
    loadedSettings: null,
  },
  version: 0,
};

/** One chat: the person asked for a picture and the reply is the generated image. */
const V0119_CHAT_STATE = {
  state: {
    conversations: [
      {
        id: CHAT_ID,
        title: CHAT_TITLE,
        modelId: MODEL.id,
        createdAt: iso(-3_700_000),
        updatedAt: iso(-3_600_000),
        messages: [
          {
            id: 'u0119',
            uuid: '1d6c3f0a-8e2b-4b7c-9f4d-2a5e6b7c8d90',
            role: 'user',
            content: `Draw ${IMAGE_PROMPT}`,
            timestamp: NOW - 3_700_000,
            turnKind: 'image',
          },
          {
            id: 'a0119',
            uuid: '2e7d4a1b-9f3c-4c8d-8a5e-3b6f7c8d9e01',
            role: 'assistant',
            content: `Generated image for: "${IMAGE_PROMPT}"`,
            timestamp: NOW - 3_600_000,
            attachments: [
              { id: IMAGE_ID, type: 'image', uri: `file://${IMAGE_PATH}`, width: 512, height: 512 },
            ],
            generationTimeMs: 41_000,
            generationMeta: {
              gpu: true,
              gpuBackend: 'Core ML (ANE)',
              modelName: 'Stable Diffusion 2.1',
              steps: CUSTOM_IMAGE_STEPS,
              guidanceScale: 7.5,
              resolution: '512x512',
            },
          },
        ],
      },
    ],
    activeConversationId: CHAT_ID,
  },
  version: 2,
};

const V0119_PROJECT_STATE = {
  state: {
    projects: [
      {
        id: PROJECT_ID,
        name: PROJECT,
        description: '',
        systemPrompt: 'Answer from the project documents.',
        icon: '#6366F1',
        createdAt: iso(-7_200_000),
        updatedAt: iso(-7_200_000),
      },
    ],
  },
  version: 0,
};

const V0119_WHISPER_STATE = {
  state: { downloadedModelId: WHISPER_ID, transcriptionLanguage: 'en' },
  version: 0,
};

/** FTS5 token characters for the Indian scripts, as v0.0.119's documents store declared them. */
function indicTokenChars(): string {
  const chars: number[] = [];
  for (let code = 0x0900; code <= 0x0d7f; code++) if (code !== 0x0964 && code !== 0x0965) chars.push(code);
  chars.push(0x200c, 0x200d);
  return String.fromCodePoint(...chars).replace(/'/g, "''");
}

/** documents.db as v0.0.119's src/services/documents/store.ts created it: no embedding_model table. */
const V0119_DOCUMENTS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS attached_documents (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 0, chunk_count INTEGER NOT NULL DEFAULT 0,
    embedded_count INTEGER NOT NULL DEFAULT 0, unreadable_pages INTEGER NOT NULL DEFAULT 0,
    embedder TEXT NOT NULL DEFAULT 'none', schema_version INTEGER NOT NULL DEFAULT 0,
    error TEXT, map TEXT, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS attached_document_pages (
    document_id TEXT NOT NULL, page INTEGER NOT NULL, label TEXT, text TEXT NOT NULL,
    needs_ocr INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (document_id, page))`,
  `CREATE TABLE IF NOT EXISTS attached_document_chunks (
    document_id TEXT NOT NULL, position INTEGER NOT NULL, page INTEGER NOT NULL, label TEXT,
    heading TEXT, text TEXT NOT NULL, tokens INTEGER NOT NULL, vector BLOB,
    PRIMARY KEY (document_id, position))`,
  `CREATE TABLE IF NOT EXISTS conversation_document_exclusions (
    conversation_id TEXT NOT NULL, document_id TEXT NOT NULL,
    PRIMARY KEY (conversation_id, document_id))`,
  'CREATE INDEX IF NOT EXISTS idx_conversation_document_exclusions_document_id ON conversation_document_exclusions(document_id)',
  `CREATE VIRTUAL TABLE IF NOT EXISTS attached_document_fts USING fts5(
    body, document_id UNINDEXED, position UNINDEXED,
    tokenize = "unicode61 remove_diacritics 0 tokenchars '${indicTokenChars()}'")`,
];

/** rag.db as v0.0.119's src/services/rag/database.ts created it. */
const V0119_RAG_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS rag_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_id TEXT,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    document_id TEXT
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_documents_sync_id ON rag_documents(sync_id)',
  'CREATE INDEX IF NOT EXISTS idx_rag_documents_project_id_enabled ON rag_documents(project_id, enabled)',
  'CREATE INDEX IF NOT EXISTS idx_rag_documents_document_id ON rag_documents(document_id)',
];

/** What v0.0.119 left on the disk, in its databases and in its saved state. */
async function leaveAsV0119Did(
  databases: string,
  boundary: NativeBoundary,
  engine: DocumentEngineBoundary,
): Promise<void> {
  const fs = boundary.fs!;
  fs.seedFile(MODEL.filePath, MODEL.fileSize);
  fs.seedFile(WHISPER_FILE, 142 * MB);
  fs.seedFile(IMAGE_PATH, 412 * 1024);
  fs.seedFile(`${DOCS}/${EMBEDDING_MODEL}`, 25 * MB);
  engine.seedPdf(KEPT_PDF, [PDF_TEXT]);
  const documentId = await engine.documentIdOf(KEPT_PDF);
  const pdfSize = (await fs.module.stat(KEPT_PDF)).size;

  // The PDF as v0.0.119's ingest left it: read, split, embedded by MiniLM, mapped.
  const rag = require('@offgrid/rag/documents');
  const pages = [{ page: 1, text: PDF_TEXT }];
  expect(rag.pageNeedsOcr(PDF_TEXT)).toBe(false);
  const { chunks } = await rag.splitPages(documentId, 'pdf', rag.cleanPages(pages));
  expect(chunks.length).toBeGreaterThan(0);
  const miniLm = await boundary.llama!.module.initLlama({ model: `${DOCS}/${EMBEDDING_MODEL}`, embedding: true });
  const vectors: number[][] = [];
  for (const chunk of chunks) {
    const { embedding } = await miniLm.embedding(rag.indexedText(PDF_NAME, chunk));
    const norm = Math.hypot(...embedding) || 1;
    vectors.push(embedding.map((value: number) => value / norm));
  }
  await miniLm.release?.();
  const map = rag.documentMap(
    chunks.map((chunk: { position: number }) => chunk.position),
    new Map(chunks.map((chunk: { position: number }, i: number) => [chunk.position, new Float32Array(vectors[i]!)])),
  );

  const { DatabaseSync } = require('node:sqlite');
  const documents = new DatabaseSync(join(databases, 'documents.db'));
  for (const statement of V0119_DOCUMENTS_SCHEMA) documents.exec(statement);
  documents
    .prepare(
      `INSERT INTO attached_documents (id, name, kind, state, page_count, chunk_count, embedded_count,
         unreadable_pages, embedder, schema_version, error, map, created_at, last_used_at)
       VALUES (?, ?, 'pdf', 'ready', 1, ?, ?, 0, ?, ?, NULL, ?, ?, ?)`,
    )
    .run(
      documentId, PDF_NAME, chunks.length, chunks.length, EMBEDDING_MODEL, rag.DOCUMENT_SCHEMA_VERSION,
      JSON.stringify(map), NOW - 7_000_000, NOW - 7_000_000,
    );
  documents
    .prepare('INSERT INTO attached_document_pages (document_id, page, label, text, needs_ocr) VALUES (?, 1, NULL, ?, 0)')
    .run(documentId, PDF_TEXT);
  chunks.forEach((chunk: { position: number; page: number; label?: string; heading?: string; text: string; tokens: number }, i: number) => {
    documents
      .prepare(
        `INSERT INTO attached_document_chunks (document_id, position, page, label, heading, text, tokens, vector)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        documentId, chunk.position, chunk.page, chunk.label ?? null, chunk.heading ?? null, chunk.text, chunk.tokens,
        new Uint8Array(new Float32Array(vectors[i]!).buffer),
      );
    documents
      .prepare('INSERT INTO attached_document_fts (body, document_id, position) VALUES (?, ?, ?)')
      .run(rag.indexedText(PDF_NAME, chunk), documentId, chunk.position);
  });
  expect(
    documents.prepare("SELECT name FROM sqlite_master WHERE name = 'embedding_model'").all(),
  ).toHaveLength(0);
  documents.close();

  const ragDb = new DatabaseSync(join(databases, 'rag.db'));
  for (const statement of V0119_RAG_SCHEMA) ragDb.exec(statement);
  ragDb
    .prepare(
      `INSERT INTO rag_documents (sync_id, project_id, name, path, size, created_at, enabled, document_id)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .run('3f8e5b2c-0a1d-4e6f-9b7c-4c7d8e9f0a12', PROJECT_ID, PDF_NAME, KEPT_PDF, pdfSize, iso(-7_000_000), documentId);
  ragDb.close();

  const storage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');
  await storage.clear();
  await storage.setItem('@local_llm/downloaded_models', JSON.stringify([MODEL]));
  await storage.setItem('local-llm-app-storage', JSON.stringify(V0119_APP_STATE));
  await storage.setItem('local-llm-chat-storage', JSON.stringify(V0119_CHAT_STATE));
  await storage.setItem('local-llm-project-storage', JSON.stringify(V0119_PROJECT_STATE));
  await storage.setItem('local-llm-whisper-storage', JSON.stringify(V0119_WHISPER_STATE));
}

/** A finger on the chat mic (PanResponder grant), as harness/chatHarness tapMic sends it. */
const MIC_GRANT = {
  nativeEvent: { touches: [], changedTouches: [], identifier: 1, pageX: 0, pageY: 0, timestamp: 0 },
  touchHistory: { touchBank: [], numberActiveTouches: 0, indexOfSingleActiveTouch: -1, mostRecentTimeStamp: 0 },
};

const WAIT = { timeout: 8000 };

/** What the composer shows: its value, or (with Scribe's underlines) the text of its children. */
function composerText(node: { props: { value?: string }; children: unknown[] }): string {
  if (typeof node.props.value === 'string') return node.props.value;
  return node.children
    .map(child => (typeof child === 'string' ? child : composerText(child as typeof node)))
    .join('');
}

describe('an install upgraded from v0.0.119', () => {
  let databases: string;
  beforeEach(() => {
    databases = mkdtempSync(join(tmpdir(), 'offgrid-upgrade-v0119-'));
  });
  afterEach(() => {
    rmSync(databases, { recursive: true, force: true });
  });

  it('opens on Home and keeps every image, chat, setting, document and voice model it had', async () => {
    const app = await launchProjectChatApp({
      sqlite: { persistAt: databases },
      whisper: true,
      // An upgrade starts over what the earlier version left: nothing is seeded for a first launch.
      relaunchFrom: [],
      beforeApp: (boundary, engine) => leaveAsV0119Did(databases, boundary, engine),
    });
    const { view, rtl, boundary } = app;
    const { fireEvent, waitFor } = rtl;
    const fs = boundary.fs!;
    const back = () => fireEvent.press(view.getAllByLabelText('Back')[0]!);
    const noCrash = () => expect(view.queryByText('Something went wrong')).toBeNull();

    // ── Home renders, past onboarding.
    expect(view.getByTestId('home-screen')).toBeTruthy();
    expect(view.queryByTestId('onboarding-skip')).toBeNull();
    noCrash();

    // ── Gallery: the image v0.0.119 drew is there, and it loads from its file.
    fireEvent.press(view.getByText('Image Gallery'));
    await view.findByTestId('gallery-screen', {}, WAIT);
    const tile = await view.findByTestId(`gallery-image-${IMAGE_ID}`, {}, WAIT);
    expect(tile.props.accessibilityLabel).toBe(`Generated image loading: ${IMAGE_PROMPT}`);
    await decodeRenderedImages(view.UNSAFE_root, fs.module);
    await waitFor(() =>
      expect(view.getByTestId(`gallery-image-${IMAGE_ID}`).props.accessibilityLabel).toBe(
        `Generated image loaded: ${IMAGE_PROMPT}`,
      ),
    );
    expect(view.queryByText('Image is not on this device')).toBeNull();
    noCrash();
    fireEvent.press(view.getByTestId('gallery-back'));
    await view.findByTestId('home-screen', {}, WAIT);

    // ── The chat with the image is listed and opens with its image.
    fireEvent.press(view.getByTestId('chats-tab'));
    const row = await waitFor(() => view.getByText(CHAT_TITLE), WAIT);
    expect(view.queryByTestId('generated-image-content')).toBeNull();
    fireEvent.press(row);
    await view.findByTestId('generated-image-content', {}, WAIT);
    expect(view.getByText(`Draw ${IMAGE_PROMPT}`)).toBeTruthy();
    expect(view.getByTestId('generated-image').props.accessibilityLabel).toBe('Generated image loading');
    await decodeRenderedImages(view.UNSAFE_root, fs.module);
    await waitFor(() =>
      expect(view.getByTestId('generated-image').props.accessibilityLabel).toBe('Generated image loaded'),
    );
    noCrash();
    back();

    // ── Settings → Analytics: both switches off. v0.0.119 never asked, so nothing is shared.
    fireEvent.press(await waitFor(() => view.getByTestId('settings-tab'), WAIT));
    await view.findByTestId('settings-analytics', {}, WAIT);
    expect(view.getByLabelText('Anonymous stats').props.value).toBe(false);
    expect(view.getByLabelText('Crash reports').props.value).toBe(false);

    // ── Settings → Model Settings → Image Generation: the custom Image Steps value is kept.
    fireEvent.press(view.getByTestId('open-model-settings'));
    const imageAccordion = await view.findByTestId('image-generation-accordion', {}, WAIT);
    expect(view.queryByTestId('image-steps-value')).toBeNull();
    fireEvent.press(imageAccordion);
    const steps = await view.findByTestId('image-steps-value', {}, WAIT);
    expect(steps.props.children).toBe(String(CUSTOM_IMAGE_STEPS));
    noCrash();
    back();

    // ── Settings → Storage opens.
    fireEvent.press(await waitFor(() => view.getByText('Storage'), WAIT));
    await view.findByText('Storage Usage', {}, WAIT);
    noCrash();
    // Its header's arrow (the button carries no label): the pressable beside the screen's title.
    const title = view.getAllByText('Storage').at(-1)!;
    let header = title.parent;
    while (header && !header.findAll(node => typeof node.props.onPress === 'function').length) header = header.parent;
    fireEvent.press(header!.findAll(node => typeof node.props.onPress === 'function')[0]!);
    await waitFor(() => expect(view.queryByText('Storage Usage')).toBeNull(), WAIT);

    // ── Home → Models: the speech-to-text model v0.0.119 downloaded is the one chosen.
    fireEvent.press(await waitFor(() => view.getByTestId('home-tab'), WAIT));
    expect(view.getByTestId('model-summary-speech').props.accessibilityState).toEqual({ selected: true });
    fireEvent.press(view.getByTestId('model-summary-speech-open'));
    await view.findByText('TRANSCRIPTION MODEL', {}, WAIT);
    // English-only Base is the chosen row (the multilingual one shares its name and is not).
    await waitFor(() =>
      expect(
        view.getAllByLabelText(WHISPER_NAME).filter(card => card.props.accessibilityState?.selected),
      ).not.toHaveLength(0),
    );
    fireEvent.press(view.getByTestId('app-sheet-close'));
    await waitFor(() => expect(view.queryByText('TRANSCRIPTION MODEL')).toBeNull(), WAIT);

    // ── The project's PDF answers a question in a project chat, and the answer cites it.
    await app.openProject(PROJECT);
    fireEvent.press(view.getByTestId('project-tab-knowledge'));
    expect(view.getByText(PDF_NAME)).toBeTruthy();
    await app.newProjectChat();
    expect(view.queryAllByRole('link')).toHaveLength(0);
    await app.ask(QUESTION, /Achilles killed Hector/, [
      {
        text: '',
        toolCalls: [{
          id: 'call_kb_0',
          type: 'function',
          function: { name: 'search_knowledge_base', arguments: JSON.stringify({ query: QUESTION }) },
        }] as never,
      },
      { text: ANSWER },
    ]);
    const citation = await waitFor(() => view.getByRole('link', { name: 'p. 1' }), WAIT);
    fireEvent.press(citation);
    const page = await waitFor(() => view.getByTestId('document-preview-page-1'), WAIT);
    expect(view.getByText(PDF_NAME)).toBeTruthy();
    expect(rtl.within(page).getByText(PDF_TEXT)).toBeTruthy();
    fireEvent.press(view.getByTestId('document-preview-back'));

    // ── The old Whisper model still loads and transcribes: hold the mic, speak, the words land in the box.
    const input = await view.findByTestId('chat-input', {}, WAIT);
    expect(composerText(input)).toBe('');
    const mic = await waitFor(() => view.getByTestId('voice-record-button'), WAIT);
    expect(mic.props.accessibilityLabel).toBe('Start voice recording');
    fireEvent(mic, 'responderGrant', MIC_GRANT);
    await waitFor(() => expect(boundary.whisper!.hasRealtimeSubscriber()).toBe(true), WAIT);
    await waitFor(
      () => expect(view.getByTestId('voice-record-button').props.accessibilityLabel).toBe('Stop voice recording'),
      WAIT,
    );
    await rtl.act(async () => {
      boundary.whisper!.emitRealtime({ text: SPOKEN, isCapturing: false });
    });
    await waitFor(() => expect(composerText(view.getByTestId('chat-input'))).toContain(SPOKEN), WAIT);
    expect(view.queryByTestId('voice-record-button-unavailable')).toBeNull();
    noCrash();

    await app.close();
  });
});
