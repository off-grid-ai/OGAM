/**
 * modelReadiness — the single source of truth for mapping a load failure to a typed reason, a reason to
 * user-facing alert copy, and "is a usable text model loaded for this turn".
 *
 * ensureModelReady runs on the real chat loader (useChatModelActions.ensureModelLoadedFn), the real
 * activeModelService and residency manager, and the real llama / LiteRT services. Faked (device,
 * harness/generationDevice): llama.rn, the LiteRT native module, the filesystem, RAM.
 */
import { reasonFromLoadError, modelNotReadyAlert } from '../../../src/screens/ChatScreen/modelReadiness';
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';
import { GB } from '../../harness/nativeBoundary';

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
});

describe('reasonFromLoadError', () => {
  it('maps "not found" / missing-file errors to not-downloaded', () => {
    expect(reasonFromLoadError(new Error('Model not found'))).toBe('not-downloaded');
    expect(reasonFromLoadError(new Error('ENOENT: no such file'))).toBe('not-downloaded');
    expect(reasonFromLoadError(new Error('mmproj file is missing'))).toBe('not-downloaded');
  });

  it('maps memory/OOM errors to insufficient-memory', () => {
    expect(reasonFromLoadError(new Error('insufficient memory'))).toBe('insufficient-memory');
    expect(reasonFromLoadError(new Error('process killed by jetsam'))).toBe('insufficient-memory');
    expect(reasonFromLoadError(new Error('ran out of memory'))).toBe('insufficient-memory');
    expect(reasonFromLoadError(new Error('Not enough RAM for this model'))).toBe('insufficient-memory');
  });

  it('does not call a remote account error a memory error', () => {
    expect(reasonFromLoadError(new Error('Insufficient credits. Add more using https://openrouter.ai/settings/credits')))
      .toBe('load-threw');
  });

  it('falls back to load-threw for anything else', () => {
    expect(reasonFromLoadError(new Error('llama init failed'))).toBe('load-threw');
    expect(reasonFromLoadError('weird string')).toBe('load-threw');
  });
});

describe('modelNotReadyAlert', () => {
  it('gives a distinct title for each reason (no generic dead-end)', () => {
    const titles = (['no-model-selected', 'not-downloaded', 'insufficient-memory', 'load-in-progress', 'load-threw'] as const)
      .map(r => modelNotReadyAlert(r).title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('includes the underlying detail in the load-threw message when present', () => {
    expect(modelNotReadyAlert('load-threw', 'llama init failed').message).toContain('llama init failed');
  });

  it('uses a safe fallback message when no detail is given', () => {
    expect(modelNotReadyAlert('load-threw').message).toBe('The model failed to load. Please try again.');
  });

  it('insufficient-memory prompts the user to close other apps (the kill-apps prompt)', () => {
    const a = modelNotReadyAlert('insufficient-memory');
    expect(a.message).toMatch(/close other apps/i);
  });

  it('insufficient-memory keeps the underlying detail above the close-apps guidance', () => {
    const a = modelNotReadyAlert('insufficient-memory', 'needs ~7GB');
    expect(a.message).toContain('needs ~7GB');
    expect(a.message).toMatch(/close other apps/i);
  });
});

/**
 * The chat screen's readiness wiring for model `m`: the real loader the screen passes as
 * ensureModelLoaded, with the screen's state setters recording what they were given.
 */
function chatReadiness(d: GenerationDevice) {
  // From the module graph the launched device runs on (launching resets modules).
  const { ensureModelLoadedFn } = require('../../../src/screens/ChatScreen/useChatModelActions');
  const alerts: any[] = [];
  const activeModel = d.useAppStore.getState().downloadedModels.find((m: any) => m.id === 'm');
  const loaderDeps = {
    activeModel,
    activeModelId: 'm',
    activeConversationId: d.conversationId,
    isStreaming: false,
    settings: { showGenerationDetails: false },
    clearStreamingMessage: () => d.useChatStore.getState().clearStreamingMessage(),
    createConversation: (id: string) => d.useChatStore.getState().createConversation(id),
    addMessage: (id: string, msg: any) => d.useChatStore.getState().addMessage(id, msg),
    setIsModelLoading: () => {},
    setLoadingModel: () => {},
    setSupportsVision: () => {},
    setShowModelSelector: () => {},
    setAlertState: (a: any) => alerts.push(a),
    modelLoadStartTimeRef: { current: null },
  };
  const deps = {
    activeModelInfo: { isRemote: false },
    activeModel,
    activeModelId: 'm',
    ensureModelLoaded: (onResume?: () => void) => ensureModelLoadedFn(loaderDeps as any, onResume),
    setAlertState: (a: any) => alerts.push(a),
  };
  const shown = () => [...alerts].reverse().find(a => a.visible);
  const { ensureModelReady, ensureReadyOrAlert } = require('../../../src/screens/ChatScreen/modelReadiness');
  return { deps, alerts, shown, ensureModelReady, ensureReadyOrAlert };
}

async function until(check: () => boolean, what: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 10));
  }
}

// A model too big for what this phone has free: the normal memory gate refuses it, "Load Anyway" loads it.
const TIGHT_PHONE = { platform: 'android' as const, totalBytes: 8 * GB, availBytes: 3 * GB };
const BIG_MODEL = 6 * GB;

describe('ensureModelReady — resume-after-Load-Anyway wiring (regression)', () => {
  // The bug: the llama (GGUF) branch called ensureModelLoaded() with NO argument, dropping onLoadedResume
  // — so after a "Load Anyway" force-load the turn never resumed and the user had to hit resend.
  it.each(['llama', 'litert'] as const)(
    'on %s, a "Load Anyway" force-loads the model and then resumes the turn that asked for it',
    async engine => {
      const d = await launchGeneration({ engine, load: false, ram: TIGHT_PHONE, modelFileSizeBytes: BIG_MODEL });
      const { deps, shown, ensureModelReady } = chatReadiness(d);
      let resumed = 0;

      const outcome = await ensureModelReady(deps as any, () => { resumed += 1; });

      expect(outcome).toEqual(expect.objectContaining({ ok: false, reason: 'insufficient-memory', alerted: true }));
      expect(shown().title).toBe('Insufficient Memory');
      expect(resumed).toBe(0);
      expect(d.activeModelService.getActiveModels().text.modelId).toBeFalsy();

      shown().buttons.find((b: any) => b.text === 'Load Anyway').onPress();
      await until(() => resumed === 1, 'the resumed turn');

      expect(resumed).toBe(1);
      const loaded = engine === 'litert' ? d.liteRTService : d.llmService;
      expect(loaded.isModelLoaded()).toBe(true);
      expect(loaded.getLoadedModelPath()).toBe(deps.activeModel.filePath);
      expect(await ensureModelReady(deps as any)).toEqual({ ok: true });
    },
  );

  it('does not load again (or resume) when the llama model is already resident', async () => {
    const d = await launchGeneration();
    const inits = d.boundary.llama!.calls.initLlama.length;
    const { deps, alerts, ensureModelReady } = chatReadiness(d);
    let resumed = 0;

    const outcome = await ensureModelReady(deps as any, () => { resumed += 1; });

    expect(outcome).toEqual({ ok: true });
    expect(d.boundary.llama!.calls.initLlama).toHaveLength(inits);
    expect(resumed).toBe(0);
    expect(alerts).toEqual([]);
  });

  it('reloads when the llama path is set but its context stopped answering (desync guard)', async () => {
    // The latent flakiness: the fast path trusted the loaded path alone and generated against a context
    // that no longer answers. A reply that ended early (no EOS, no stop, no cap) marks it for reload.
    const d = await launchGeneration();
    d.boundary.llama!.scriptCompletion({
      text: 'cut', completionMeta: { stopped_eos: false, stopped_limit: 0, truncated: false, tokens_predicted: 3, tokens_evaluated: 4 },
    });
    await d.llmService.generateResponse([{ id: 'u', role: 'user', content: 'hi', timestamp: 0 }]);
    expect(d.llmService.getLoadedModelPath()).toBeTruthy();
    expect(d.llmService.isContextUsable()).toBe(false);
    const inits = d.boundary.llama!.calls.initLlama.length;
    const { deps, ensureModelReady } = chatReadiness(d);

    const outcome = await ensureModelReady(deps as any);

    expect(d.boundary.llama!.calls.initLlama).toHaveLength(inits + 1); // it did NOT falsely short-circuit
    expect(outcome).toEqual({ ok: true });
    expect(d.llmService.isContextUsable()).toBe(true);
  });

  it('does not load again when the LiteRT model is already resident', async () => {
    const d = await launchGeneration({ engine: 'litert' });
    const loads = d.boundary.litert.calls.loadModel.length;
    const { deps, alerts, ensureModelReady } = chatReadiness(d);

    const outcome = await ensureModelReady(deps as any);

    expect(outcome).toEqual({ ok: true });
    expect(d.boundary.litert.calls.loadModel).toHaveLength(loads);
    expect(alerts).toEqual([]);
  });
});

describe('ensureReadyOrAlert', () => {
  it('a remote model is ready without any local load', async () => {
    const d = await launchGeneration({ load: false });
    const { deps, alerts, ensureReadyOrAlert } = chatReadiness(d);

    expect(await ensureReadyOrAlert({ ...deps, activeModelInfo: { isRemote: true } } as any, 'test')).toBe(true);
    expect(d.boundary.llama!.calls.initLlama).toHaveLength(0);
    expect(alerts).toEqual([]);
  });

  it('with no model chosen, refuses the turn and shows the no-model alert', async () => {
    const d = await launchGeneration({ localModel: false });
    const { deps, shown, ensureReadyOrAlert } = chatReadiness(d);

    expect(await ensureReadyOrAlert({ ...deps, activeModel: null, activeModelId: null } as any, 'test')).toBe(false);
    expect(shown().title).toBe(modelNotReadyAlert('no-model-selected').title);
  });

  it('does not show a second alert over the Insufficient Memory prompt the loader already showed', async () => {
    const d = await launchGeneration({ load: false, ram: TIGHT_PHONE, modelFileSizeBytes: BIG_MODEL });
    const { deps, alerts, ensureReadyOrAlert } = chatReadiness(d);

    expect(await ensureReadyOrAlert(deps as any, 'test', () => {})).toBe(false);
    expect(alerts.filter(a => a.visible).map(a => a.title)).toEqual(['Insufficient Memory']);
  });

  it('a load that fails shows the reason-specific alert from the loader', async () => {
    const d = await launchGeneration({ load: false });
    d.boundary.llama!.scriptInitFailure(true);
    const { deps, alerts, ensureReadyOrAlert } = chatReadiness(d);

    expect(await ensureReadyOrAlert(deps as any, 'test')).toBe(false);
    const visible = alerts.filter(a => a.visible);
    expect(visible).toHaveLength(1);
    expect(visible[0].title).toBe('Error');
    expect(visible[0].message).toMatch(/^Failed to load model: /);
  });
});
