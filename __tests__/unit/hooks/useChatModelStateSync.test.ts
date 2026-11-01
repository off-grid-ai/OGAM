/**
 * useChatModelStateSync — what the chat screen says the model can do (vision, tools, thinking), across a
 * server model, LiteRT and llama.
 *
 * The two remote checks differ on purpose and are kept: the vision effect keys on activeModelInfo.isRemote,
 * the tools/thinking effect on activeRemoteTextModelId.
 *
 * Real: the hook, llmService, liteRTService, activeModelService (models load through the residency lock),
 * the stores. Faked (device, harness/nativeBoundary): llama.rn (and whether its projector starts), the
 * LiteRT native module, the filesystem, RAM. The setters are the screen's own state setters, passed in.
 */
import { installNativeBoundary, requireRTL, GB, type NativeBoundary } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

interface Phone {
  boundary: NativeBoundary;
  activeModelService: any;
  useAppStore: any;
  rtl: ReturnType<typeof requireRTL>;
}

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
});

/** A phone with these models downloaded (files on disk, records added through the store's action). */
function phone(models: Array<{ id: string; engine?: 'llama' | 'litert'; liteRTVision?: boolean; projector?: boolean }>, opts: { projectorStarts?: boolean } = {}): Phone {
  const boundary = installNativeBoundary({
    llama: true,
    fs: true,
    llamaVision: opts.projectorStarts,
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
  const rtl = requireRTL();
  const dir = `${boundary.fs!.DocumentDirectoryPath}/models`;
  const { useAppStore } = require('../../../src/stores');
  const { activeModelService } = require('../../../src/services/activeModelService');
  for (const m of models) {
    const engine = m.engine ?? 'llama';
    const fileName = engine === 'llama' ? `${m.id}.gguf` : `${m.id}.litertlm`;
    boundary.fs!.seedFile(`${dir}/${fileName}`, 500 * 1024 * 1024);
    const projector = m.projector ? `${dir}/${m.id}-mmproj-f16.gguf` : undefined;
    if (projector) boundary.fs!.seedFile(projector, 80 * 1024 * 1024);
    useAppStore.getState().addDownloadedModel(createDownloadedModel({
      id: m.id, name: m.id, engine, fileName, filePath: `${dir}/${fileName}`, fileSize: 2 * GB,
      liteRTVision: m.liteRTVision,
      ...(projector ? { mmProjPath: projector, mmProjFileName: `${m.id}-mmproj-f16.gguf`, isVisionModel: true } : {}),
    }));
  }
  return { boundary, activeModelService, useAppStore, rtl };
}

/** Render the hook for the chosen model and read what it last set. */
function capabilities(p: Phone, deps: Record<string, unknown> = {}) {
  const { useChatModelStateSync } = require('../../../src/screens/ChatScreen/useChatModelActions');
  const seen: Record<'vision' | 'tools' | 'thinking', boolean | undefined> = { vision: undefined, tools: undefined, thinking: undefined };
  const state = p.useAppStore.getState();
  p.rtl.renderHook(() =>
    useChatModelStateSync({
      activeModelInfo: { isRemote: false },
      activeModelId: state.activeModelId,
      activeModel: state.downloadedModels.find((m: any) => m.id === state.activeModelId),
      modelDeps: {},
      activeRemoteModel: null,
      activeRemoteTextModelId: null,
      isModelLoading: false,
      setSupportsVision: (v: boolean) => { seen.vision = v; },
      setSupportsToolCalling: (v: boolean) => { seen.tools = v; },
      setSupportsThinking: (v: boolean) => { seen.thinking = v; },
      ...deps,
    }),
  );
  return seen;
}

describe('useChatModelStateSync — what the chat says the model can do', () => {
  it('a server model: what the server declared', () => {
    const p = phone([]);

    const caps = capabilities(p, {
      activeModelInfo: { isRemote: true },
      activeModelId: null,
      activeRemoteTextModelId: 'srv/llama',
      activeRemoteModel: { capabilities: { supportsVision: true, supportsToolCalling: true, supportsThinking: false } },
    });

    expect(caps).toEqual({ vision: true, tools: true, thinking: false });
  });

  it('a loaded LiteRT model: vision from its flag, tools and thinking on', async () => {
    const p = phone([{ id: 'l', engine: 'litert', liteRTVision: true }]);
    p.activeModelService.selectTextModel('l');
    await p.activeModelService.loadTextModel('l');

    expect(capabilities(p)).toEqual({ vision: true, tools: true, thinking: true });
  });

  it('a LiteRT model not loaded yet: vision still from its flag, tools and thinking off', () => {
    const p = phone([{ id: 'l', engine: 'litert', liteRTVision: true }]);
    p.activeModelService.selectTextModel('l');

    expect(capabilities(p)).toEqual({ vision: true, tools: false, thinking: false });
  });

  it('a loaded llama model whose projector started: what the engine reports', async () => {
    const p = phone([{ id: 'v', projector: true }], { projectorStarts: true });
    p.activeModelService.selectTextModel('v');
    await p.activeModelService.loadTextModel('v');

    expect(capabilities(p)).toEqual({ vision: true, tools: true, thinking: true });
  });

  it('a llama model with nothing loaded: all off', () => {
    const p = phone([{ id: 'm' }]);
    p.activeModelService.selectTextModel('m');

    expect(capabilities(p)).toEqual({ vision: false, tools: false, thinking: false });
  });

  it('a vision model picked while a text-only model is still loaded shows vision, not the loaded model\'s', async () => {
    // Qwen 3.5 2B (no projector) is loaded; Qwen 3.5 0.8B with a projector is picked and loads on send.
    const p = phone([{ id: 'qwen-2b' }, { id: 'qwen-0.8b', projector: true }]);
    p.activeModelService.selectTextModel('qwen-2b');
    await p.activeModelService.loadTextModel('qwen-2b');
    p.activeModelService.selectTextModel('qwen-0.8b');

    expect(capabilities(p).vision).toBe(true);
  });
});
