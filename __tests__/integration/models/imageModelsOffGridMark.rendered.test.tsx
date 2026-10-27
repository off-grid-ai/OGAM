/**
 * Off Grid AI's own image builds carry its mark on the Image tab, in the picks and in the list,
 * as text and video models do. Another source's model does not.
 *
 * Real ModelsScreen, Image tab, picks row, cards and the shared credibility rule. Fakes only at the
 * device boundary: the RAM sensor, the file system and the network (Hugging Face through fetch).
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

describe('Off Grid AI mark on image models', () => {
  it('marks exactly Off Grid AI builds, in the list and the picks', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('[]', { status: 200 })) as typeof fetch;
    try {
      const React = require('react');
      const { render, fireEvent, waitFor, within } = requireRTL();
      const AsyncStorage =
        require('@react-native-async-storage/async-storage').default ??
        require('@react-native-async-storage/async-storage');
      await AsyncStorage.clear();
      // What App.tsx does at launch: read the device first.
      await require('../../../src/services/hardware').hardwareService.getDeviceInfo();
      const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

      const models = render(React.createElement(ModelsScreen));
      fireEvent.press(models.getByText('Image'));
      // Off Grid AI's own image builds (huggingface.co/offgrid-ai): the SDXL style family.
      const OURS = /\b(RealVisXL|Juggernaut|DreamShaper|Animagine|Illustrious)\b/;
      await waitFor(() => expect(models.queryAllByTestId(/^image-model-card-\d+$/).length).toBeGreaterThan(0), { timeout: 4000 });

      // Every card and pick shown: the mark appears exactly on Off Grid AI's builds, whatever this
      // phone is offered (the offer follows the phone's memory).
      const named = (node: any) => within(node).queryAllByText(/./).map((t: any) => String(t.props.children)).join(' ');
      const shown = [
        ...models.queryAllByTestId(/^image-model-card-\d+$/),
        ...['fast', 'balanced', 'best'].map(slot => models.queryByTestId(`pick-${slot}`)).filter(Boolean),
      ];
      let ourCount = 0;
      for (const node of shown) {
        const ours = OURS.test(named(node).trim());
        if (ours) ourCount++;
        expect([named(node), within(node).queryAllByTestId('made-by-off-grid').length > 0]).toEqual([named(node), ours]);
      }
      expect(ourCount).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
