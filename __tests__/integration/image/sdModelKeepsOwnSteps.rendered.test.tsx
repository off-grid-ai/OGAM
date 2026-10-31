/**
 * An sd.cpp model keeps its own image settings.
 *
 * SPEC (OGAM user's view): the steps the phone uses for an image depend on the model. A few-step
 * sd.cpp model (RealVisXL Lightning) starts at its own steps from the shared policy (10, as on Off Grid
 * Desktop), not the 50 the native image engines use; a change made while it is active is kept for that
 * model alone, and the native engine's model still shows its own value.
 *
 * The real ImageQualityBasicSliders over the real app store, rehydrated from device storage the way a
 * launch does. Device boundary only: storage (AsyncStorage) and the RAM sensor.
 */
import { GB, installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

const LIGHTNING = {
  id: 'sd-offgrid-ai--realvisxl-v5.0-lightning-GGUF-Q4', name: 'RealVisXL v5.0 Lightning (Light)',
  description: '', modelPath: '/models/realvisxl', downloadedAt: '2026-10-27T00:00:00.000Z', size: 2.6 * GB, backend: 'sd',
};
const NATIVE = {
  id: 'naianimev2_npu_min', name: 'Nai Anime V2 (NPU non-flagship)',
  description: '', modelPath: '/models/nai', downloadedAt: '2026-10-27T00:00:00.000Z', size: 0.9 * GB, backend: 'qnn',
};

async function launchSliders(activeImageModelId: string, overrides?: Record<string, unknown>) {
  installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 6 * GB } });
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  await AsyncStorage.setItem('local-llm-app-storage', JSON.stringify({
    state: {
      downloadedImageModels: [LIGHTNING, NATIVE], activeImageModelId,
      settings: { imageSteps: 50, imageGuidanceScale: 7.5, imageWidth: 512, imageHeight: 512, ...(overrides ? { imageParameterOverrides: overrides } : {}) },
    },
    version: 0,
  }));
  const React = require('react');
  const rtl = requireRTL();
  const { useAppStore } = require('../../../src/stores/appStore');
  await useAppStore.persist.rehydrate();
  const { ImageQualityBasicSliders } = require('../../../src/components/GenerationSettingsModal/ImageQualitySliders');
  return { rtl, view: rtl.render(React.createElement(ImageQualityBasicSliders)), useAppStore };
}

const stepsShown = (view: any) => Number(view.getByTestId('image-steps-value').props.children);

it('a Lightning model starts at its own steps, and a change stays with it', async () => {
  const first = await launchSliders(LIGHTNING.id);
  expect(stepsShown(first.view)).toBe(10);
  first.rtl.fireEvent.press(first.view.getByTestId('image-steps-value-button'));
  first.rtl.fireEvent.changeText(first.view.getByTestId('image-steps-input'), '6');
  first.rtl.fireEvent(first.view.getByTestId('image-steps-input'), 'submitEditing');
  await first.rtl.waitFor(() => expect(stepsShown(first.view)).toBe(6));
  const saved = first.useAppStore.getState().settings.imageParameterOverrides;
  first.view.unmount();

  // The native engine's model, after a relaunch with what was saved: still the global 50.
  const native = await launchSliders(NATIVE.id, saved);
  expect(stepsShown(native.view)).toBe(50);
  native.view.unmount();

  // Back on the Lightning model: its own 6.
  const again = await launchSliders(LIGHTNING.id, saved);
  expect(stepsShown(again.view)).toBe(6);
  again.view.unmount();
});
