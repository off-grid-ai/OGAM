import {
  CHAT_CAPABILITIES,
  CHAT_PLATFORMS,
  CHAT_REMOTE_PROVIDERS_BY_CAPABILITY,
  CHAT_RUNTIME_MATRIX,
  CHAT_RUNTIME_SUPPORT,
  CHAT_SCENARIO_MATRIX,
  forEveryRuntime,
  forEveryRuntimeCombination,
  usingLiteRT,
  usingLMStudio,
  usingLlama,
  usingOGAD,
} from './chatScenario';

const runtimeIdentity = (runtime: (typeof CHAT_RUNTIME_MATRIX)[number]) =>
  [
    runtime.platform,
    runtime.capability,
    runtime.source,
    runtime.engine,
    runtime.remoteProvider ?? '-',
  ].join('|');

describe('chat scenario matrix contract', () => {
  it('contains each declared platform, capability, engine, and provider exactly once', () => {
    const expected = CHAT_PLATFORMS.flatMap(platform =>
      CHAT_CAPABILITIES.flatMap(capability => [
        ...CHAT_RUNTIME_SUPPORT[platform][capability].local.map(engine =>
          [platform, capability, 'local', engine, '-'].join('|'),
        ),
        ...CHAT_RUNTIME_SUPPORT[platform][capability].remote.map(provider =>
          [platform, capability, 'remote', 'remote', provider].join('|'),
        ),
      ]),
    );
    const actual = CHAT_RUNTIME_MATRIX.map(runtimeIdentity);

    expect(new Set(actual).size).toBe(actual.length);
    expect(actual).toEqual(expected);
  });

  it('limits LM Studio and Ollama to text while Off Grid Desktop exposes every modality', () => {
    expect(CHAT_REMOTE_PROVIDERS_BY_CAPABILITY).toEqual({
      text: ['lmstudio', 'ollama', 'offgrid-desktop'],
      image: ['offgrid-desktop'],
      stt: ['offgrid-desktop'],
      tts: ['offgrid-desktop'],
    });
  });

  it('rejects unsupported combinations at construction', () => {
    expect(() => usingLiteRT({ platform: 'ios' })).toThrow(
      'Unsupported chat runtime',
    );
    expect(() => usingLMStudio().withPhotoAttachment('gallery')).toThrow(
      'cannot accept a photo attachment',
    );
    expect(() => usingOGAD().withPhotoAttachment('gallery')).not.toThrow();
    expect(() => usingLlama().usingChatMode('voice')).toThrow(
      'Voice chat requires both STT and TTS runtimes',
    );
    expect(usingLlama().withTools('all').tools).toEqual([
      'built-in',
      'pro',
      'remote',
      'mcp',
    ]);
  });

  it('builds every compatible text and image combination on the same platform', () => {
    const combinations = forEveryRuntimeCombination(['text', 'image']);
    const expectedCount = CHAT_PLATFORMS.reduce(
      (count, platform) =>
        count +
        forEveryRuntime('text').filter(runtime => runtime.platform === platform)
          .length *
          forEveryRuntime('image').filter(runtime => runtime.platform === platform)
            .length,
      0,
    );

    expect(combinations).toHaveLength(expectedCount);
    expect(
      combinations.every(
        combination =>
          combination.runtimes.text?.platform === combination.platform &&
          combination.runtimes.image?.platform === combination.platform,
      ),
    ).toBe(true);
  });

  it('publishes one visible index for every generated journey matrix', () => {
    expect(Object.keys(CHAT_SCENARIO_MATRIX)).toEqual([
      'runtimes',
      'textChat',
      'voiceChat',
      'thinkingDisabled',
      'builtInTools',
      'proTools',
      'mcpTools',
      'localImage',
      'remoteImage',
      'imageGeneration',
      'photoAttachment',
      'documentAttachment',
    ]);
    expect(CHAT_SCENARIO_MATRIX.textChat).not.toHaveLength(0);
    expect(CHAT_SCENARIO_MATRIX.voiceChat).not.toHaveLength(0);
    expect(CHAT_SCENARIO_MATRIX.imageGeneration).not.toHaveLength(0);
  });
});
