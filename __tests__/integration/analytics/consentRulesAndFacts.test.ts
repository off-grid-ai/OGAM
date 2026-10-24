/**
 * The consent-prompt rules, the features snapshot and the model facts, over the real stores
 * (docs/ANALYTICS.md: Consent, `features_snapshot`, Shared value rules). The rendered prompts are
 * covered by consentPrompts.rendered.test.tsx; these are the edges the journeys do not reach.
 */
import { Platform } from 'react-native';
import { useAppStore } from '../../../src/stores/appStore';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { registerHook, HOOKS, _clearHooksForTesting } from '../../../src/bootstrap/hookRegistry';
import {
  closeConsentPrompt,
  maybePromptAfterFailure,
  maybePromptAfterFirstChat,
  useConsentPromptStore,
} from '../../../src/services/analytics/consentPrompt';
import { featureSnapshot } from '../../../src/services/analytics/featureSnapshot';
import { imageModelFacts, textModelFacts, videoModelFacts, REMOTE_MODEL_FACTS } from '../../../src/services/analytics/modelFacts';
import { createDownloadedModel } from '../../utils/factories';

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  closeConsentPrompt();
  useAppStore.getState().resetSettings();
  useAppStore.getState().updateSettings({ analyticsAsked: false, analyticsLastPromptAt: null });
  _clearHooksForTesting();
});

describe('consent prompt rules', () => {
  it('asks after a failure once, then waits 30 days', () => {
    expect(useConsentPromptStore.getState().kind).toBeNull();
    maybePromptAfterFailure();
    expect(useConsentPromptStore.getState().kind).toBe('failure');
    closeConsentPrompt();
    maybePromptAfterFailure();
    expect(useConsentPromptStore.getState().kind).toBeNull();
    useAppStore.getState().updateSettings({ analyticsLastPromptAt: Date.now() - 31 * DAY });
    maybePromptAfterFailure();
    expect(useConsentPromptStore.getState().kind).toBe('failure');
  });

  it('one prompt at a time, and never for someone already opted in', () => {
    maybePromptAfterFailure();
    maybePromptAfterFirstChat();
    expect(useConsentPromptStore.getState().kind).toBe('failure');
    closeConsentPrompt();
    useAppStore.getState().updateSettings({ analyticsCrashes: true, analyticsLastPromptAt: null, analyticsAsked: false });
    maybePromptAfterFailure();
    maybePromptAfterFirstChat();
    expect(useConsentPromptStore.getState().kind).toBeNull();
  });

  it('the first-chat prompt is once ever', () => {
    maybePromptAfterFirstChat();
    expect(useConsentPromptStore.getState().kind).toBe('first_chat');
    closeConsentPrompt();
    maybePromptAfterFirstChat();
    expect(useConsentPromptStore.getState().kind).toBeNull();
  });
});

describe('features snapshot', () => {
  it('reports each feature as switched on or off, Pro features included', () => {
    useAppStore.getState().setDownloadedModels([]);
    useAppStore.getState().setActiveModelId(null);
    useAppStore.getState().updateSettings({ enabledTools: [] });
    expect(featureSnapshot()).toEqual({
      voice_input: false, image_generation: false, video_generation: false, vision: false, web_search: false, tools: false,
      remote_server: false,
    });

    const llamaVision = createDownloadedModel({ id: 'v', engine: 'llama', isVisionModel: true });
    const litert = { ...createDownloadedModel({ id: 'l', engine: 'litert' }), liteRTVision: true };
    useAppStore.getState().setDownloadedModels([llamaVision, litert]);
    useAppStore.getState().setActiveModelId('v');
    useAppStore.getState().setActiveImageModelId('img');
    useAppStore.getState().setActiveVideoModelId('Comfy-Org/Wan_2.1_ComfyUI_repackaged');
    useAppStore.getState().updateSettings({ enabledTools: ['web_search'] });
    useRemoteServerStore.getState().addServer({ name: 'Mac', endpoint: 'http://192.168.1.2:1234', providerType: 'openai-compatible' });
    registerHook(HOOKS.analyticsProFeatures, () => ({ tts: true, sync: false }));
    expect(featureSnapshot()).toMatchObject({
      image_generation: true, video_generation: true, vision: true, web_search: true, tools: true, remote_server: true, tts: true, sync: false,
    });
    useAppStore.getState().setActiveModelId('l');
    expect(featureSnapshot().vision).toBe(true);
  });
});

describe('model facts', () => {
  it('names the route without any file name', () => {
    expect(textModelFacts(true)).toEqual(REMOTE_MODEL_FACTS);
    useAppStore.getState().setActiveModelId('missing');
    expect(textModelFacts(false)).toMatchObject({ model: 'custom', engine: 'llama.cpp' });
    useAppStore.getState().setDownloadedModels([
      { ...createDownloadedModel({ id: 'local_import/Family Recipes.gguf', engine: 'litert', quantization: '' }) },
    ]);
    useAppStore.getState().setActiveModelId('local_import/Family Recipes.gguf');
    useAppStore.getState().updateSettings({ liteRTBackend: 'npu' });
    expect(textModelFacts(false)).toEqual({ model: 'custom', quant: undefined, engine: 'litert', backend: 'npu' });

    expect(imageModelFacts({ id: 'sd_qnn', backend: 'qnn' } as never)).toEqual({ model: 'sd_qnn', engine: 'onnx', backend: 'npu' });
    expect(imageModelFacts({ id: 'sd_coreml', backend: 'coreml' } as never)).toEqual({ model: 'sd_coreml', engine: 'coreml', backend: 'gpu' });
    expect(imageModelFacts({ id: 'sd-flux', backend: 'sd' } as never)).toEqual({ model: 'sd-flux', engine: 'sd.cpp', backend: 'gpu' });
    expect(videoModelFacts('Comfy-Org/Wan_2.1_ComfyUI_repackaged')).toEqual({
      model: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged', engine: 'sd.cpp', backend: 'gpu',
    });
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    expect(imageModelFacts(undefined)).toEqual({ model: 'custom', engine: 'coreml', backend: 'cpu' });
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    expect(imageModelFacts(undefined).engine).toBe('onnx');
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  });
});
