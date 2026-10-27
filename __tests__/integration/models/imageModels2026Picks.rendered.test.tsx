/**
 * The Image tab offers this phone the 2026 image models it can run.
 *
 * A model is offered only where the memory guard will load it (934ffd377: one estimate decides both).
 * An 8 GB phone (it reports about 7.4 GB) has about 4.5 GB for a model, and FLUX.2 klein 4B (Light) needs
 * about 6.4 GB, so it is not offered there. A 12 GB phone (about 11.2 GB) gets it as a pick, and Z-Image
 * Turbo (Light) too. SDXL Lightning and SDXL Turbo, which FLUX.2 klein replaces, are no longer offered.
 *
 * Real ModelsScreen, Image tab, the shared catalog and pack rules, the sd.cpp model list and the
 * memory recommendation. Fakes only at the device boundary: the RAM sensor, the file system and the
 * network (Hugging Face through fetch, answering with no extra models).
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

describe('2026 image models on the Image tab', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('[]', { status: 200 })) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each([
    { phone: '8 GB', reportedBytes: 7.4 * GB, flux: false, zImageLight: false },
    { phone: '12 GB', reportedBytes: 11.2 * GB, flux: true, zImageLight: true },
  ])('a $phone Android phone is offered only what it can load, never SDXL Lightning or Turbo', async ({ reportedBytes, flux, zImageLight }) => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: reportedBytes, availBytes: reportedBytes / 2 } });
    const React = require('react');
    const { render, fireEvent, waitFor } = requireRTL();
    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    // What App.tsx does at launch: read the device first.
    await require('../../../src/services/hardware').hardwareService.getDeviceInfo();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));
    // Before: the Text tab shows, with no image model on screen.
    expect(models.queryAllByText(/FLUX\.2 klein 4B/)).toHaveLength(0);

    fireEvent.press(models.getByText('Image'));
    // FLUX.2 klein 4B (Light) shows as a pick ("For this phone" names the model, not its quant).
    if (flux) await waitFor(() => expect(models.getAllByText(/^FLUX\.2 klein 4B/).length).toBeGreaterThan(0), { timeout: 4000 });
    else {
      await new Promise(resolve => setTimeout(resolve, 1500));
      expect(models.queryAllByText(/FLUX\.2 klein/)).toHaveLength(0);
    }

    // The SDXL finetunes stay as style options; the replaced SDXL distills are gone.
    expect(models.queryAllByText(/SDXL Lightning/)).toHaveLength(0);
    expect(models.queryAllByText(/SDXL Turbo/)).toHaveLength(0);
    expect(models.queryAllByText(/Z-Image Turbo \(Light\)/).length > 0).toBe(zImageLight);
    // FLUX 3 Image Klein needs a newer engine than phones ship: never offered here.
    expect(models.queryAllByText(/FLUX 3 Image Klein/)).toHaveLength(0);
  });
});
