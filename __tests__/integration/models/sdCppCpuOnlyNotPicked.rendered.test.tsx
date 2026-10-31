/**
 * Where sd.cpp can only run on the CPU, its models are not picks, and their cards say how long an image takes.
 *
 * SPEC (OGAM user's view): on an Android phone with a Snapdragon (Adreno) GPU, sd.cpp images run on the
 * CPU (native/video/common/VideoRuntime.hpp), about 26 minutes for an SDXL image on a OnePlus SM8635. The
 * Image tab never makes such a model a "For this phone" pick, and each sd.cpp card says about how many
 * minutes one image takes on this phone, so nobody starts a long render by surprise. A phone whose GPU
 * runs sd.cpp keeps it among its picks.
 *
 * Real ModelsScreen, Image tab, shared catalog and memory rule. Fakes only at the device boundary: the
 * RAM sensor and SoC (Snapdragon reports its hardware as qcom), the file system, the network.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('[]', { status: 200 })) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function openImageTab(deviceHardware: string) {
  installNativeBoundary({ fs: true, deviceHardware, socModel: 'SM8635', ram: { platform: 'android', totalBytes: 11.2 * GB, availBytes: 5 * GB } });
  const React = require('react');
  const { render, fireEvent } = requireRTL();
  const AsyncStorage = require('@react-native-async-storage/async-storage').default ?? require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  await require('../../../src/services/hardware').hardwareService.getDeviceInfo();
  const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
  const models = render(React.createElement(ModelsScreen));
  fireEvent.press(models.getByText('Image'));
  return models;
}

it('a Snapdragon phone lists sd.cpp models with their time per image, and never picks them', async () => {
  const models = await openImageTab('qcom');
  const { waitFor } = requireRTL();
  const card = await waitFor(() => models.getByText(/^RealVisXL v5\.0 Lightning \(Light\)$/), { timeout: 5000 });
  expect(card).toBeTruthy();
  expect(models.getAllByText(/About \d+ min per image on this phone/).length).toBeGreaterThan(0);
  // No sd.cpp family is a pick here.
  expect(models.queryByTestId('image-picks')).toBeNull();
  expect(models.queryAllByText(/^FLUX\.2 klein 4B$/)).toHaveLength(0);
});

it('a phone whose GPU runs sd.cpp keeps sd.cpp picks and shows no CPU time', async () => {
  const models = await openImageTab('mt6989');
  const { waitFor } = requireRTL();
  await waitFor(() => expect(models.getAllByText(/^FLUX\.2 klein 4B/).length).toBeGreaterThan(0), { timeout: 5000 });
  expect(models.queryAllByText(/min per image on this phone/)).toHaveLength(0);
});
