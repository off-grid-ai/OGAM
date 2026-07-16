/**
 * makeGenDeps — the ChatScreen send/generation flow helper.
 *
 * The ChatScreen's send logic lives in exported functions (startGenerationFn / handleSendFn /
 * dispatchGenerationFn) that take a GenerationDeps. Mounting the whole ChatScreen component is a rat's
 * nest (its own test wholesale-mocks src/components); this factory instead wires a REAL GenerationDeps to
 * the REAL stores + harness, so we drive the exact routing/generation logic the screen uses and assert
 * what the user sees — alerts raised, messages added, conversations created/filed — via captured state +
 * real store reads. Call AFTER installNativeBoundary() so it binds the post-reset store singletons.
 */
export interface Captured {
  alerts: Array<{ title?: string; message?: string; buttons?: Array<{ text?: string; onPress?: () => void }> }>;
  statuses: Array<string | null>;
  pendingMessages: Array<{ text: string }>;
}

export interface GenDepsResult {
  deps: any;
  captured: Captured;
  useChatStore: any;
  useProjectStore: any;
}

export function makeGenDeps(overrides: Record<string, any> = {}): GenDepsResult {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { useChatStore } = require('../../src/stores/chatStore');
  const { useProjectStore } = require('../../src/stores/projectStore');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const captured: Captured = { alerts: [], statuses: [], pendingMessages: [] };
  const chat = useChatStore.getState();

  const settings = {
    showGenerationDetails: false, imageGenerationMode: 'auto', autoDetectMethod: 'pattern',
    classifierModelId: null, systemPrompt: 'You are helpful.', enabledTools: [],
    thinkingEnabled: false, ...(overrides.settings ?? {}),
  };

  const deps = {
    activeModelId: 'txt',
    // filePath matches the gguf a test loads via llmService.loadModel(), so engines.isModelReady()
    // (llama: loaded path === model.filePath) passes the readiness gate.
    activeModel: { id: 'txt', name: 'Txt', engine: 'llama', filePath: '/models/small.gguf' },
    activeModelInfo: { isRemote: false, model: { id: 'txt' }, modelId: 'txt', modelName: 'Txt' },
    hasActiveModel: true,
    hasTextModel: true,
    supportsToolCalling: false,
    activeConversationId: null,
    activeConversation: null,
    activeProject: null,
    activeImageModel: null,
    imageModelLoaded: false,
    isStreaming: false,
    isGeneratingImage: false,
    imageGenState: {},
    settings,
    downloadedModels: [{ id: 'txt', name: 'Txt', engine: 'llama' }],
    setAlertState: (s: any) => { captured.alerts.push(s); },
    setIsClassifying: () => {},
    setAppImageGenerationStatus: (v: string | null) => { captured.statuses.push(v); },
    setAppIsGeneratingImage: () => {},
    addMessage: (convId: string, msg: any) => chat.addMessage(convId, msg),
    clearStreamingMessage: () => chat.clearStreamingMessage(),
    deleteConversation: (convId: string) => chat.deleteConversation(convId),
    setActiveConversation: (convId: string | null) => chat.setActiveConversation(convId),
    removeImagesByConversationId: () => [],
    navigation: { navigate: () => {}, goBack: () => {}, setOptions: () => {} },
    setShowSettingsPanel: () => {},
    ensureModelLoaded: async () => ({ ok: true }),
    ensureTextModelForChat: async () => true,
    setPendingMessage: (text: string) => { captured.pendingMessages.push({ text }); },
    createConversation: (modelId: string, title?: string, projectId?: string) => chat.createConversation(modelId, title, projectId),
    pendingProjectId: undefined,
    ...overrides,
  };

  return { deps, captured, useChatStore, useProjectStore };
}
