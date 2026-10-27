/**
 * Off Grid AI's own image builds carry its mark on the Image tab, in the picks and in the list,
 * as text and video models do. Another source's model does not.
 *
 * Real ModelsScreen, Image tab, picks row, cards and the shared credibility rule. Fakes only at the
 * device boundary: the RAM sensor, the file system and the network (Hugging Face through fetch).
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

describe('Off Grid AI mark on image models', () => {
  it('marks Off Grid AI builds in the list and the picks, and leaves other sources unmarked', async () => {
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
      await waitFor(() => expect(models.getAllByText(/SDXL Lightning/).length).toBeGreaterThan(0), { timeout: 4000 });

      // In the list: an Off Grid AI build carries the mark; SDXL Turbo (OlegSkutte) does not.
      const cardOf = (name: RegExp) =>
        models.queryAllByTestId(/^image-model-card-\d+$/).find((node: any) => within(node).queryAllByText(name).length > 0);
      const ours = cardOf(/^RealVisXL v5\.0 \(photoreal\)/);
      const theirs = cardOf(/^SDXL Turbo/);
      expect(within(ours).getByTestId('made-by-off-grid')).toBeTruthy();
      expect(within(theirs).queryByTestId('made-by-off-grid')).toBeNull();

      // In the picks for this phone: the same rule per pick card.
      const pickOf = (name: RegExp) =>
        ['fast', 'balanced', 'best'].map(slot => models.queryByTestId(`pick-${slot}`))
          .find((node: any) => node && within(node).queryAllByText(name).length > 0);
      expect(within(pickOf(/Juggernaut/)).getByTestId('made-by-off-grid')).toBeTruthy();
      expect(within(pickOf(/SDXL Lightning/)).queryByTestId('made-by-off-grid')).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
