import type { RamProfile } from './nativeBoundary';

export type ChatPlatform = 'ios' | 'android';
export type ChatMode = 'text' | 'voice';
export type ChatCapability = 'text' | 'image' | 'stt' | 'tts';
export type ChatTextEngine = 'llama' | 'litert' | 'remote';
export type ChatEngine = ChatTextEngine | 'none';
export type ChatImageBackend = 'mnn' | 'qnn' | 'coreml' | 'remote';
export type ChatSttEngine = 'whisper' | 'remote';
export type ChatTtsEngine = 'kokoro' | 'remote';
export type ChatRemoteProvider = 'lmstudio' | 'ollama' | 'offgrid-desktop';
export type ChatRemoteMediaProvider = Extract<
  ChatRemoteProvider,
  'offgrid-desktop'
>;
export type ChatExecutionSource = 'local' | 'remote';
export type ChatRuntimeEngine =
  | ChatTextEngine
  | ChatImageBackend
  | ChatSttEngine
  | ChatTtsEngine;
export type ChatToolSource = 'built-in' | 'pro' | 'remote' | 'mcp' | 'all';
export type ChatPhotoSource = 'camera' | 'gallery';

type EngineForCapability = {
  text: ChatTextEngine;
  image: ChatImageBackend;
  stt: ChatSttEngine;
  tts: ChatTtsEngine;
};

export interface ChatRuntime<C extends ChatCapability = ChatCapability> {
  readonly platform: ChatPlatform;
  readonly capability: C;
  readonly source: ChatExecutionSource;
  readonly engine: EngineForCapability[C];
  readonly remoteProvider?: ChatRemoteProvider;
}

export interface ChatRuntimeCombination {
  readonly platform: ChatPlatform;
  readonly runtimes: Partial<{
    [C in ChatCapability]: ChatRuntime<C>;
  }>;
}

export interface ChatScenarioOptions {
  platform?: ChatPlatform;
  ram?: RamProfile;
  vision?: boolean;
  audio?: boolean;
  whisper?: boolean;
  download?: boolean;
  pro?: boolean;
  deferInitialLoad?: boolean;
  modelName?: string;
  modelFileName?: string;
  modelFileSizeBytes?: number;
  chatTemplate?: string;
}

type ChatScenarioState = ChatScenarioOptions & {
  engine: ChatEngine;
  imageBackend?: ChatImageBackend;
  sttEngine?: ChatSttEngine;
  ttsEngine?: ChatTtsEngine;
  thinkingEnabled?: boolean;
  imageEnhancementEnabled?: boolean;
  chatMode?: ChatMode;
  tools?: readonly ChatToolSource[];
  photoSource?: ChatPhotoSource;
  documentAttached?: boolean;
  remoteTextProvider?: ChatRemoteProvider;
  remoteImageProvider?: ChatRemoteMediaProvider;
  remoteSttProvider?: ChatRemoteMediaProvider;
  remoteTtsProvider?: ChatRemoteMediaProvider;
};

const engineLabel: Record<ChatEngine, string> = {
  llama: 'Llama text',
  litert: 'LiteRT text',
  remote: 'remote text',
  none: 'no text model',
};

export const CHAT_PLATFORMS = ['android', 'ios'] as const;
export const CHAT_CAPABILITIES = ['text', 'image', 'stt', 'tts'] as const;
export const CHAT_REMOTE_PROVIDERS = [
  'lmstudio',
  'ollama',
  'offgrid-desktop',
] as const;
export const CHAT_REMOTE_PROVIDERS_BY_CAPABILITY = {
  text: CHAT_REMOTE_PROVIDERS,
  image: ['offgrid-desktop'],
  stt: ['offgrid-desktop'],
  tts: ['offgrid-desktop'],
} as const satisfies Record<
  ChatCapability,
  readonly ChatRemoteProvider[]
>;

/**
 * The only test-harness source of truth for platform runtime support.
 * Journey matrices are joins over these rows. They never maintain their own lists.
 */
export const CHAT_RUNTIME_SUPPORT = {
  android: {
    text: {
      local: ['litert', 'llama'],
      remote: CHAT_REMOTE_PROVIDERS_BY_CAPABILITY.text,
    },
    image: {
      local: ['mnn', 'qnn'],
      remote: CHAT_REMOTE_PROVIDERS_BY_CAPABILITY.image,
    },
    stt: {
      local: ['whisper'],
      remote: CHAT_REMOTE_PROVIDERS_BY_CAPABILITY.stt,
    },
    tts: {
      local: ['kokoro'],
      remote: CHAT_REMOTE_PROVIDERS_BY_CAPABILITY.tts,
    },
  },
  ios: {
    text: {
      local: ['llama'],
      remote: CHAT_REMOTE_PROVIDERS_BY_CAPABILITY.text,
    },
    image: {
      local: ['coreml'],
      remote: CHAT_REMOTE_PROVIDERS_BY_CAPABILITY.image,
    },
    stt: {
      local: ['whisper'],
      remote: CHAT_REMOTE_PROVIDERS_BY_CAPABILITY.stt,
    },
    tts: {
      local: ['kokoro'],
      remote: CHAT_REMOTE_PROVIDERS_BY_CAPABILITY.tts,
    },
  },
} as const satisfies {
  [P in ChatPlatform]: {
    [C in ChatCapability]: {
      readonly local: readonly Exclude<EngineForCapability[C], 'remote'>[];
      readonly remote: readonly ChatRemoteProvider[];
    };
  };
};

export const CHAT_RUNTIME_MATRIX: readonly ChatRuntime[] =
  CHAT_PLATFORMS.flatMap(platform =>
    CHAT_CAPABILITIES.flatMap(capability =>
      [
        ...(CHAT_RUNTIME_SUPPORT[platform][capability].local as readonly ChatRuntimeEngine[]).map(
          engine =>
            ({ platform, capability, source: 'local', engine }) as ChatRuntime,
        ),
        ...CHAT_RUNTIME_SUPPORT[platform][capability].remote.map(
          remoteProvider =>
            ({
              platform,
              capability,
              source: 'remote',
              engine: 'remote',
              remoteProvider,
            }) as ChatRuntime,
        ),
      ],
    ),
  );

function isSupportedRuntime(runtime: ChatRuntime): boolean {
  return CHAT_RUNTIME_MATRIX.some(
    candidate =>
      candidate.platform === runtime.platform &&
      candidate.capability === runtime.capability &&
      candidate.source === runtime.source &&
      candidate.engine === runtime.engine &&
      candidate.remoteProvider === runtime.remoteProvider,
  );
}

function requireSupportedRuntime<C extends ChatCapability>(
  runtime: ChatRuntime<C>,
): ChatRuntime<C> {
  if (!isSupportedRuntime(runtime)) {
    throw new Error(
      `Unsupported chat runtime: ${runtime.platform}/${runtime.capability}/${runtime.engine}/${runtime.remoteProvider ?? runtime.source}`,
    );
  }
  return runtime;
}

export function forEveryRuntime<C extends ChatCapability>(
  capability: C,
): readonly ChatRuntime<C>[] {
  return CHAT_RUNTIME_MATRIX.filter(
    (runtime): runtime is ChatRuntime<C> => runtime.capability === capability,
  );
}

/** Join every compatible engine for the requested capabilities on the same platform. */
export function forEveryRuntimeCombination(
  capabilities: readonly ChatCapability[],
): readonly ChatRuntimeCombination[] {
  return CHAT_PLATFORMS.flatMap(platform => {
    let combinations: ChatRuntimeCombination[] = [{ platform, runtimes: {} }];
    for (const capability of capabilities) {
      const candidates = CHAT_RUNTIME_MATRIX.filter(
        runtime =>
          runtime.platform === platform && runtime.capability === capability,
      );
      combinations = combinations.flatMap(combination =>
        candidates.map(runtime => ({
          platform,
          runtimes: {
            ...combination.runtimes,
            [capability]: runtime,
          },
        })),
      );
    }
    return combinations;
  });
}

export function getBackendForPlatform(
  platform: ChatPlatform,
  capability: 'image',
): Exclude<ChatImageBackend, 'qnn' | 'remote'> {
  return platform === 'ios' ? 'coreml' : 'mnn';
}

/** Immutable, executable setup for one rendered Chat-screen journey. */
export class ChatScenario {
  readonly label: string;
  readonly engine: ChatEngine;
  readonly platform: ChatPlatform;
  readonly ram?: RamProfile;
  readonly vision?: boolean;
  readonly audio?: boolean;
  readonly whisper?: boolean;
  readonly download?: boolean;
  readonly pro?: boolean;
  readonly deferInitialLoad?: boolean;
  readonly modelName?: string;
  readonly modelFileName?: string;
  readonly modelFileSizeBytes?: number;
  readonly chatTemplate?: string;
  readonly imageBackend?: ChatImageBackend;
  readonly sttEngine?: ChatSttEngine;
  readonly ttsEngine?: ChatTtsEngine;
  readonly thinkingEnabled?: boolean;
  readonly imageEnhancementEnabled?: boolean;
  readonly chatMode: ChatMode;
  readonly tools?: readonly ChatToolSource[];
  readonly photoSource?: ChatPhotoSource;
  readonly documentAttached?: boolean;
  readonly remoteTextProvider?: ChatRemoteProvider;
  readonly remoteImageProvider?: ChatRemoteMediaProvider;
  readonly remoteSttProvider?: ChatRemoteMediaProvider;
  readonly remoteTtsProvider?: ChatRemoteMediaProvider;

  private constructor(state: ChatScenarioState) {
    this.engine = state.engine;
    this.platform = state.platform ?? 'android';
    this.ram = state.ram;
    this.vision = state.vision;
    this.audio = state.audio;
    this.whisper = state.whisper;
    this.download = state.download;
    this.pro = state.pro;
    this.deferInitialLoad = state.deferInitialLoad;
    this.modelName = state.modelName;
    this.modelFileName = state.modelFileName;
    this.modelFileSizeBytes = state.modelFileSizeBytes;
    this.chatTemplate = state.chatTemplate;
    this.imageBackend = state.imageBackend;
    this.sttEngine = state.sttEngine;
    this.ttsEngine = state.ttsEngine;
    this.thinkingEnabled = state.thinkingEnabled;
    this.imageEnhancementEnabled = state.imageEnhancementEnabled;
    this.chatMode = state.chatMode ?? 'text';
    this.tools = state.tools;
    this.photoSource = state.photoSource;
    this.documentAttached = state.documentAttached;
    this.remoteTextProvider = state.remoteTextProvider;
    this.remoteImageProvider = state.remoteImageProvider;
    this.remoteSttProvider = state.remoteSttProvider;
    this.remoteTtsProvider = state.remoteTtsProvider;

    const parts = [
      this.platform,
      `${this.chatMode} chat`,
      engineLabel[this.engine],
    ];
    if (this.remoteTextProvider) parts.push(`${this.remoteTextProvider} provider`);
    if (this.sttEngine) parts.push(`${this.sttEngine} STT`);
    if (this.ttsEngine) parts.push(`${this.ttsEngine} TTS`);
    if (this.imageBackend) {
      parts.push(
        this.remoteImageProvider
          ? `${this.remoteImageProvider} image`
          : `${this.imageBackend} image`,
      );
    }
    if (this.imageEnhancementEnabled !== undefined) {
      parts.push(
        `image enhancement ${this.imageEnhancementEnabled ? 'ON' : 'OFF'}`,
      );
    }
    if (this.thinkingEnabled !== undefined) {
      parts.push(`Thinking ${this.thinkingEnabled ? 'ON' : 'OFF'}`);
    }
    if (this.tools?.length) parts.push(`${this.tools.join(' + ')} tools`);
    if (this.photoSource) parts.push(`${this.photoSource} photo`);
    if (this.documentAttached) parts.push('document attachment');
    this.label = parts.join(' + ');
  }

  static fromTextRuntime(
    runtime: ChatRuntime<'text'>,
    options: Omit<ChatScenarioOptions, 'platform'> = {},
  ): ChatScenario {
    const supported = requireSupportedRuntime(runtime);
    return new ChatScenario({
      ...options,
      platform: supported.platform,
      engine: supported.engine,
      remoteTextProvider: supported.remoteProvider,
    });
  }

  static withoutText(
    platform: ChatPlatform,
    options: Omit<ChatScenarioOptions, 'platform'> = {},
  ): ChatScenario {
    return new ChatScenario({ ...options, platform, engine: 'none' });
  }

  private copy(patch: Partial<ChatScenarioState>): ChatScenario {
    return new ChatScenario({ ...this, ...patch });
  }

  usingBackend(
    capability: 'image',
    backend: ChatImageBackend = getBackendForPlatform(this.platform, capability),
  ): ChatScenario {
    requireSupportedRuntime({
      platform: this.platform,
      capability,
      source: backend === 'remote' ? 'remote' : 'local',
      engine: backend,
      remoteProvider:
        backend === 'remote' ? this.remoteImageProvider : undefined,
    });
    return this.copy({ imageBackend: backend });
  }

  usingRemoteImage(
    remoteProvider: ChatRemoteMediaProvider = 'offgrid-desktop',
  ): ChatScenario {
    requireSupportedRuntime({
      platform: this.platform,
      capability: 'image',
      source: 'remote',
      engine: 'remote',
      remoteProvider,
    });
    return this.copy({ imageBackend: 'remote', remoteImageProvider: remoteProvider });
  }

  usingSpeechToText(
    engine: ChatSttEngine,
    remoteProvider?: ChatRemoteMediaProvider,
  ): ChatScenario {
    requireSupportedRuntime({
      platform: this.platform,
      capability: 'stt',
      source: engine === 'remote' ? 'remote' : 'local',
      engine,
      remoteProvider: engine === 'remote' ? remoteProvider : undefined,
    });
    return this.copy({
      sttEngine: engine,
      whisper: engine === 'whisper',
      remoteSttProvider: engine === 'remote' ? remoteProvider : undefined,
    });
  }

  usingTextToSpeech(
    engine: ChatTtsEngine,
    remoteProvider?: ChatRemoteMediaProvider,
  ): ChatScenario {
    requireSupportedRuntime({
      platform: this.platform,
      capability: 'tts',
      source: engine === 'remote' ? 'remote' : 'local',
      engine,
      remoteProvider: engine === 'remote' ? remoteProvider : undefined,
    });
    return this.copy({
      ttsEngine: engine,
      remoteTtsProvider: engine === 'remote' ? remoteProvider : undefined,
      pro: true,
    });
  }

  usingChatMode(chatMode: ChatMode): ChatScenario {
    if (chatMode === 'voice' && (!this.sttEngine || !this.ttsEngine)) {
      throw new Error('Voice chat requires both STT and TTS runtimes.');
    }
    return this.copy({
      chatMode,
      pro: chatMode === 'voice' ? true : this.pro,
    });
  }

  inChatThinkingEnabled(): ChatScenario {
    if (this.engine === 'none') {
      throw new Error('Thinking requires a text runtime.');
    }
    return this.copy({ thinkingEnabled: true });
  }

  inChatThinkingDisabled(): ChatScenario {
    if (this.engine === 'none') {
      throw new Error('Thinking requires a text runtime.');
    }
    return this.copy({ thinkingEnabled: false });
  }

  inChatImageEnhancementEnabled(): ChatScenario {
    if (!this.imageBackend || this.engine === 'none') {
      throw new Error('Image prompt enhancement requires image and text runtimes.');
    }
    return this.copy({ imageEnhancementEnabled: true });
  }

  inChatImageEnhancementDisabled(): ChatScenario {
    if (!this.imageBackend) {
      throw new Error('Image prompt settings require an image runtime.');
    }
    return this.copy({ imageEnhancementEnabled: false });
  }

  withTools(...tools: readonly ChatToolSource[]): ChatScenario {
    if (this.engine === 'none') {
      throw new Error('Tools require a text runtime.');
    }
    const expanded = tools.includes('all')
      ? (['built-in', 'pro', 'remote', 'mcp'] as const)
      : tools;
    return this.copy({
      tools: [...new Set(expanded)],
      pro: expanded.some(tool => tool !== 'built-in') || this.pro,
    });
  }

  withPhotoAttachment(source: ChatPhotoSource): ChatScenario {
    if (
      this.engine === 'none' ||
      (this.engine === 'remote' && this.remoteTextProvider !== 'offgrid-desktop')
    ) {
      throw new Error(`${this.label} cannot accept a photo attachment.`);
    }
    return this.copy({ photoSource: source, vision: true });
  }

  withDocumentAttachment(): ChatScenario {
    if (this.engine === 'none') {
      throw new Error('A document attachment requires a text runtime.');
    }
    return this.copy({ documentAttached: true });
  }

  expectsEnhancedImagePrompt(): boolean {
    return (
      this.imageBackend !== 'remote' &&
      this.imageEnhancementEnabled === true &&
      this.engine !== 'none'
    );
  }
}

export function usingEngine(
  engine: ChatEngine,
  options: ChatScenarioOptions = {},
): ChatScenario {
  const platform = options.platform ?? 'android';
  if (engine === 'none') {
    return ChatScenario.withoutText(platform, options);
  }
  if (engine === 'remote') {
    throw new Error('Use a named remote text provider constructor.');
  }
  return ChatScenario.fromTextRuntime(
    requireSupportedRuntime({
      platform,
      capability: 'text',
      source: 'local',
      engine,
    }),
    options,
  );
}

export const usingLlama = (options: ChatScenarioOptions = {}): ChatScenario =>
  usingEngine('llama', options);

export const usingLiteRT = (options: ChatScenarioOptions = {}): ChatScenario =>
  usingEngine('litert', options);

export const usingRemoteText = (
  options: ChatScenarioOptions = {},
  remoteProvider: ChatRemoteProvider = 'lmstudio',
): ChatScenario =>
  ChatScenario.fromTextRuntime(
    requireSupportedRuntime({
      platform: options.platform ?? 'android',
      capability: 'text',
      source: 'remote',
      engine: 'remote',
      remoteProvider,
    }),
    options,
  );

export const usingLMStudio = (
  options: ChatScenarioOptions = {},
): ChatScenario => usingRemoteText(options, 'lmstudio');

export const usingOllama = (
  options: ChatScenarioOptions = {},
): ChatScenario => usingRemoteText(options, 'ollama');

export const usingOGAD = (
  options: ChatScenarioOptions = {},
): ChatScenario => usingRemoteText(options, 'offgrid-desktop');

export const withoutTextModel = (
  options: ChatScenarioOptions = {},
): ChatScenario =>
  ChatScenario.withoutText(options.platform ?? 'android', options);

function scenarioForTextRuntime(runtime: ChatRuntime<'text'>): ChatScenario {
  return ChatScenario.fromTextRuntime(runtime);
}

function remoteMediaProvider(
  runtime: ChatRuntime<'image' | 'stt' | 'tts'>,
): ChatRemoteMediaProvider {
  if (runtime.remoteProvider !== 'offgrid-desktop') {
    throw new Error(
      `${runtime.remoteProvider ?? 'Unknown provider'} does not expose ${runtime.capability}.`,
    );
  }
  return runtime.remoteProvider;
}

function scenarioForCombination(
  combination: ChatRuntimeCombination,
): ChatScenario {
  const text = combination.runtimes.text;
  let scenario = text
    ? scenarioForTextRuntime(text)
    : withoutTextModel({ platform: combination.platform });
  const image = combination.runtimes.image;
  const stt = combination.runtimes.stt;
  const tts = combination.runtimes.tts;
  if (image) {
    scenario = image.source === 'remote'
      ? scenario.usingRemoteImage(remoteMediaProvider(image))
      : scenario.usingBackend('image', image.engine);
  }
  if (stt) {
    scenario = scenario.usingSpeechToText(
      stt.engine,
      stt.source === 'remote' ? remoteMediaProvider(stt) : undefined,
    );
  }
  if (tts) {
    scenario = scenario.usingTextToSpeech(
      tts.engine,
      tts.source === 'remote' ? remoteMediaProvider(tts) : undefined,
    );
  }
  return scenario;
}

export function forEveryTextRuntime(
  configure: (
    scenario: ChatScenario,
  ) => ChatScenario | readonly ChatScenario[] = scenario => scenario,
): ChatScenario[] {
  return forEveryRuntime('text').flatMap(runtime => {
    const configured = configure(scenarioForTextRuntime(runtime));
    return configured instanceof ChatScenario ? [configured] : [...configured];
  });
}

export function forEveryChatModeRuntime(chatMode: ChatMode): ChatScenario[] {
  if (chatMode === 'text') {
    return forEveryTextRuntime(scenario => scenario.usingChatMode('text'));
  }
  return forEveryRuntimeCombination(['text', 'stt', 'tts']).map(combination =>
    scenarioForCombination(combination).usingChatMode('voice'),
  );
}

export const CHAT_TEXT_SCENARIOS = forEveryChatModeRuntime('text');
export const CHAT_VOICE_SCENARIOS = forEveryChatModeRuntime('voice');
export const CHAT_LOCAL_TEXT_SCENARIOS = CHAT_TEXT_SCENARIOS.filter(
  scenario => scenario.engine !== 'remote',
);

export const CHAT_THINKING_DISABLED_SCENARIOS = forEveryTextRuntime(scenario =>
  scenario.inChatThinkingDisabled(),
);

export const CHAT_BUILT_IN_TOOL_SCENARIOS = forEveryTextRuntime(scenario =>
  scenario.withTools('built-in'),
);

export const CHAT_PRO_TOOL_SCENARIOS = forEveryTextRuntime(scenario =>
  scenario.withTools('pro'),
);

export const CHAT_MCP_TOOL_SCENARIOS = forEveryTextRuntime(scenario =>
  scenario.withTools('mcp'),
);

export const CHAT_LOCAL_IMAGE_SCENARIOS = forEveryRuntimeCombination([
  'text',
  'image',
])
  .map(scenarioForCombination)
  .filter(scenario => scenario.imageBackend !== 'remote');

export const CHAT_REMOTE_IMAGE_SCENARIOS = forEveryRuntimeCombination([
  'text',
  'image',
])
  .map(scenarioForCombination)
  .filter(scenario => scenario.imageBackend === 'remote');

export const CHAT_IMAGE_SCENARIOS = [
  ...CHAT_LOCAL_IMAGE_SCENARIOS,
  ...CHAT_REMOTE_IMAGE_SCENARIOS,
] as const;

export const CHAT_PHOTO_ATTACHMENT_SCENARIOS = forEveryTextRuntime(scenario =>
  scenario.engine !== 'remote' ||
  scenario.remoteTextProvider === 'offgrid-desktop'
    ? [
        scenario.withPhotoAttachment('camera'),
        scenario.withPhotoAttachment('gallery'),
      ]
    : [],
);

export const CHAT_DOCUMENT_ATTACHMENT_SCENARIOS = forEveryTextRuntime(scenario =>
  scenario.withDocumentAttachment(),
);

const textAndImageScenarios = forEveryRuntimeCombination(['text', 'image']).map(
  scenarioForCombination,
);
const imageOnlyScenarios = forEveryRuntime('image').map(runtime =>
  runtime.source === 'remote'
    ? withoutTextModel({ platform: runtime.platform }).usingRemoteImage(
        remoteMediaProvider(runtime),
      )
    : withoutTextModel({ platform: runtime.platform }).usingBackend(
        'image',
        runtime.engine,
      ),
);

/** Every valid text x image route, plus image-only use when enhancement is off. */
export const CHAT_IMAGE_GENERATION_SCENARIOS = [
  ...textAndImageScenarios.flatMap(scenario => [
    scenario.inChatImageEnhancementEnabled().inChatThinkingEnabled(),
    scenario.inChatImageEnhancementEnabled().inChatThinkingDisabled(),
    scenario.inChatImageEnhancementDisabled().inChatThinkingEnabled(),
    scenario.inChatImageEnhancementDisabled().inChatThinkingDisabled(),
  ]),
  ...imageOnlyScenarios.map(scenario =>
    scenario.inChatImageEnhancementDisabled(),
  ),
] as const;

/** One visible index of the generated matrices that rendered Chat journeys consume. */
export const CHAT_SCENARIO_MATRIX = {
  runtimes: CHAT_RUNTIME_MATRIX,
  textChat: CHAT_TEXT_SCENARIOS,
  voiceChat: CHAT_VOICE_SCENARIOS,
  thinkingDisabled: CHAT_THINKING_DISABLED_SCENARIOS,
  builtInTools: CHAT_BUILT_IN_TOOL_SCENARIOS,
  proTools: CHAT_PRO_TOOL_SCENARIOS,
  mcpTools: CHAT_MCP_TOOL_SCENARIOS,
  localImage: CHAT_LOCAL_IMAGE_SCENARIOS,
  remoteImage: CHAT_REMOTE_IMAGE_SCENARIOS,
  imageGeneration: CHAT_IMAGE_GENERATION_SCENARIOS,
  photoAttachment: CHAT_PHOTO_ATTACHMENT_SCENARIOS,
  documentAttachment: CHAT_DOCUMENT_ATTACHMENT_SCENARIOS,
} as const;
