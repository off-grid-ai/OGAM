/**
 * Every voice in the voice-mode picker is its own accessible control. A screen reader (and any
 * automation driving the app the same way) must be able to find each voice row by its role and name
 * and choose it, not land on one opaque popover.
 *
 * Real ChatScreen with Pro active, voice mode entered through the real quick-settings control, the
 * picker opened by tapping the voice button in the audio input row. Fakes only at the device
 * boundary: the LiteRT engine, whisper.rn, the executorch TTS runtime (jest.setup) and the recorder.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

type HostNode = { type?: unknown; props?: Record<string, unknown>; parent?: HostNode | null };

/** Host ancestors that a screen reader would read as one element, swallowing everything inside. */
function groupingAncestors(row: unknown): string[] {
  const found: string[] = [];
  let node = (row as HostNode).parent ?? null;
  while (node) {
    if (typeof node.type === 'string' && node.props?.accessible === true) {
      found.push(`${node.type}${node.props.testID ? `#${String(node.props.testID)}` : ''}`);
    }
    node = node.parent ?? null;
  }
  return found;
}

describe('voice picker accessibility', () => {
  it('exposes each voice row as a named button a screen reader can reach and choose', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, pro: true });
    await h.setupWhisperModel();
    h.render();
    await h.enterVoiceMode();
    const view = h.view!;

    // The voice button in the audio input row names the current voice.
    const trigger = await h.rtl.waitFor(() => view.getByText('Heart'));

    // Before: the picker is closed, so no voice row is exposed.
    expect(view.queryByRole('button', { name: 'Heart', selected: true })).toBeNull();
    expect(view.queryByRole('button', { name: 'Michael' })).toBeNull();

    h.rtl.fireEvent.press(trigger);

    // Each voice offered for the language is its own button, found by role and by label.
    const expected = ['Heart', 'River', 'Sarah', 'Adam', 'Michael', 'Santa'];
    await h.rtl.waitFor(() => expect(view.getByRole('button', { name: 'Michael' })).toBeTruthy());
    for (const name of expected) {
      const row = view.getByRole('button', { name });
      expect(view.getAllByLabelText(name).length).toBeGreaterThan(0);
      // RNTL's role query does not model grouping: on a device, an accessible ancestor swallows its
      // subtree into ONE element and VoiceOver/TalkBack never reach the row. Read the accessibility
      // tree the screen reader sees: no ancestor of the row may be an accessibility element.
      expect(groupingAncestors(row)).toEqual([]);
    }
    // The current voice reads as selected; the others do not.
    expect(view.getByRole('button', { name: 'Heart', selected: true })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Michael', selected: true })).toBeNull();

    // Choosing a row through its accessible handle switches the voice: the input row names it.
    h.rtl.fireEvent.press(view.getByRole('button', { name: 'Michael' }));
    await h.rtl.waitFor(() => expect(view.queryByRole('button', { name: 'Adam' })).toBeNull());
    await h.rtl.waitFor(() => expect(view.getByText('Michael')).toBeTruthy(), { timeout: 8000 });
  });
});
