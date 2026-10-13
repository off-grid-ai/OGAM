import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AutoSetupScreen } from '../../../src/screens/AutoSetupScreen';
import type { AutoSetupCatalogBoundaries } from '../../../src/services/autoSetupCatalog';
import { createAutoSetupSession } from '../../../src/services/autoSetupService';

const MB = 1024 * 1024;

const catalog: AutoSetupCatalogBoundaries = {
  totalMemoryGB: () => 12,
  fetchTextFiles: async models =>
    Object.fromEntries(
      models.map(model => [
        model.id,
        [
          {
            name: 'model.gguf',
            size: 400 * MB,
            quantization: 'Q4_K_M',
            downloadUrl: 'https://models.test/model.gguf',
          },
        ],
      ]),
    ),
  imageRecommendation: async () => ({
    recommendedBackend: 'qnn',
    compatibleBackends: ['qnn'],
    qnnVariant: '8gen2',
    bannerText: 'NPU models available',
  }),
  imageModels: async () => [
    {
      id: 'absolutereality_cpu',
      name: 'Absolute Reality (GPU)',
      description: 'Absolute Reality',
      size: 50 * MB,
      downloadUrl: 'https://models.test/absolute-reality-gpu.zip',
      style: 'photorealistic',
      backend: 'mnn',
    },
    {
      id: 'naianime_npu_8gen2',
      name: 'NAI Anime (NPU 8gen2)',
      description: 'NAI Anime',
      size: 100 * MB,
      downloadUrl: 'https://models.test/nai-anime.zip',
      style: 'anime',
      backend: 'qnn',
      variant: '8gen2',
    },
    {
      id: 'absolutereality_npu_8gen2',
      name: 'Absolute Reality (NPU 8gen2)',
      description: 'Absolute Reality',
      size: 200 * MB,
      downloadUrl: 'https://models.test/absolute-reality.zip',
      style: 'photorealistic',
      backend: 'qnn',
      variant: '8gen2',
    },
  ],
};

/** Open a plan's details; the device's own plan starts open, and its heading toggles. */
function openPlan(ui: ReturnType<typeof render>, tier: string): void {
  const heading = ui.getByTestId(`auto-setup-plan-heading-${tier}`);
  if (!heading.props.accessibilityState?.expanded) fireEvent.press(heading);
}

test('Auto Setup shows Absolute Reality when the device catalog would choose NAI Anime', async () => {
  const navigation = { push() {}, replace() {} } as never;
  const ui = render(
    <AutoSetupScreen
      navigation={navigation}
      sessionFactory={() => createAutoSetupSession({ catalog })}
    />,
  );

  await waitFor(() =>
    expect(ui.getByTestId('auto-setup-plan-lean')).toBeTruthy(),
  );
  for (const tier of ['lean', 'balanced', 'extreme']) {
    openPlan(ui, tier);
    expect(ui.getByText('Absolute Reality (NPU 8gen2)')).toBeTruthy();
    expect(ui.queryByText('Absolute Reality (GPU)')).toBeNull();
    expect(ui.queryByText('NAI Anime (NPU 8gen2)')).toBeNull();
  }
});

test('Auto Setup offers the GPU model when the device recommends GPU', async () => {
  const navigation = { push() {}, replace() {} } as never;
  const ui = render(
    <AutoSetupScreen
      navigation={navigation}
      sessionFactory={() =>
        createAutoSetupSession({
          catalog: {
            ...catalog,
            imageRecommendation: async () => ({
              recommendedBackend: 'mnn',
              compatibleBackends: ['mnn'],
              bannerText: 'GPU models available',
            }),
          },
        })
      }
    />,
  );

  await waitFor(() =>
    expect(ui.getByTestId('auto-setup-plan-balanced')).toBeTruthy(),
  );
  openPlan(ui, 'balanced');
  expect(ui.getByText('Absolute Reality (GPU)')).toBeTruthy();
  expect(ui.queryByText('Absolute Reality (NPU 8gen2)')).toBeNull();
});

test('Android Auto Setup presents complementary image models across its three plans', async () => {
  const navigation = { push() {}, replace() {} } as never;
  const ui = render(
    <AutoSetupScreen
      navigation={navigation}
      sessionFactory={() => createAutoSetupSession({
        catalog: {
          ...catalog,
          imageModels: async () => [
            ...(await catalog.imageModels()),
            {
              id: 'anythingv5_npu_8gen2', name: 'Anything V5 (NPU 8gen2)',
              description: 'Anything V5', size: 150 * MB,
              downloadUrl: 'https://models.test/anything-v5.zip',
              style: 'anime', backend: 'qnn', variant: '8gen2',
            },
            {
              id: 'dreamshaperv8_npu_8gen2', name: 'Dream Shaper V8 (NPU 8gen2)',
              description: 'Dream Shaper V8', size: 250 * MB,
              downloadUrl: 'https://models.test/dream-shaper-v8.zip',
              style: 'general', backend: 'qnn', variant: '8gen2',
            },
          ],
        },
      })}
    />,
  );

  await waitFor(() => expect(ui.getByTestId('auto-setup-plan-lean')).toBeTruthy());
  for (const [tier, name] of [
    ['lean', 'Anything V5 (NPU 8gen2)'],
    ['balanced', 'Absolute Reality (NPU 8gen2)'],
    ['extreme', 'Dream Shaper V8 (NPU 8gen2)'],
  ]) {
    openPlan(ui, tier);
    expect(ui.getByText(name)).toBeTruthy();
  }
});
