/**
 * The voice model card on Models > Voice never claims "At least 0GB RAM". Kokoro needs well under a
 * gigabyte, and a minimum of zero is not a requirement worth printing: the card shows its real facts
 * (a voice model, its streaming size in MB) and no RAM floor.
 *
 * Real ModelsScreen with Pro active (the real bootstrap fills the Voice tab slot), reached by tapping
 * the Voice tab. Fakes only at the device boundary: the filesystem, RAM sensor and the executorch
 * resource fetcher (jest.setup).
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('voice model card RAM fact', () => {
  it('shows the Kokoro card on the Voice tab without an "At least 0GB RAM" fact', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB } });
    const React = require('react');
    const rtl = requireRTL();
    const { installPro } = require('../../harness/proHarness');
    await installPro();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const view = rtl.render(React.createElement(ModelsScreen, {}));

    // Before: the Models screen opens on Text, so no voice model card is on screen yet.
    await rtl.waitFor(() => expect(view.getByTestId('voice-models-tab')).toBeTruthy());
    expect(view.queryByText('Kokoro TTS')).toBeNull();

    // The person opens the Voice tab.
    rtl.fireEvent.press(view.getByTestId('voice-models-tab'));

    // The card renders with its real facts: a voice model whose size is in megabytes (under 1GB).
    await rtl.waitFor(() => expect(view.getByText('Kokoro TTS')).toBeTruthy(), { timeout: 4000 });
    const card = view.getByTestId('voice-model-kokoro');
    expect(rtl.within(card).getByText('Voice')).toBeTruthy();
    expect(rtl.within(card).getByText(/Streaming · \d+ MB/)).toBeTruthy();

    // No RAM floor of zero anywhere on the screen, and the card states no RAM minimum at all (the
    // device banner above it still names this phone's RAM, which is a different fact).
    expect(view.queryByText(/At least 0\s*GB RAM/)).toBeNull();
    expect(rtl.within(card).queryByText(/At least/)).toBeNull();
    expect(rtl.within(card).queryByText(/GB RAM/)).toBeNull();
  });
});
