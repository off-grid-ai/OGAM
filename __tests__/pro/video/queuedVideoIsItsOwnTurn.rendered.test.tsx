/**
 * A queued video prompt is always its own turn; queued text follows the shared queue rule.
 *
 * SPEC (the user's view): while a reply is running I send a question, then switch to video and
 * describe a clip, then switch back and send another question. When the reply ends, my two
 * questions are answered together (the shared queue rule, as on Off Grid Desktop), and the clip is
 * made from my description alone — never from my questions mixed into it.
 *
 * Real ChatScreen, generation service, queue and Pro's video service. Fakes only at the boundaries: the
 * llama.rn engine (held so the first reply stays running) and Off Grid Desktop's video gateway at
 * fetch, whose saved server record is what pairing leaves behind.
 */
import React from 'react';
import { setupChatScreen } from '../../harness/chatHarness';
import {
  DESKTOP_VIDEO_ENDPOINT,
  DESKTOP_VIDEO_MODEL,
  serveDesktopVideoJobs,
  type DesktopVideoJobs,
} from '../../harness/desktopVideoServer';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

const CLIP = 'a paper boat on a pond';
const COMBINED_REPLY = 'Both questions, answered together.';

let desktop: DesktopVideoJobs | undefined;

afterEach(() => {
  desktop?.restore();
  desktop = undefined;
  require('../../../src/stores/remoteServerStore').useRemoteServerStore.getState().clearAllServers();
});

it('queued questions go together and a queued video prompt goes alone', async () => {
  const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
  const { rtl } = h;
  desktop = serveDesktopVideoJobs(h.boundary.fs!);

  // Desktop's saved record, then its video model picked in the real remote-model picker.
  const { remoteServerManager } = require('../../../src/services/remoteServerManager');
  const { RemoteModelOptionsSection } = require('../../../src/components/models/RemoteModelOptionsSection');
  const server = await remoteServerManager.addServer({
    name: 'Studio Mac',
    endpoint: DESKTOP_VIDEO_ENDPOINT,
    providerType: 'openai-compatible',
    modelManagement: 'offgrid-desktop-v1',
    modelCatalog: { video: [DESKTOP_VIDEO_MODEL] },
  });
  const rowId = `remote-video-model-${server.id}:${DESKTOP_VIDEO_MODEL.id}`;
  const picker = rtl.render(React.createElement(RemoteModelOptionsSection, { category: 'video' }));
  rtl.fireEvent.press(picker.getByTestId(rowId));
  await rtl.waitFor(() => expect(picker.getByTestId(rowId).props.accessibilityState?.selected).toBe(true));
  picker.unmount();

  // Video is Pro: the app activates it before the chat opens.
  await require('../../harness/proHarness').installPro();
  h.render();
  const view = h.view!;
  const toggleVideoMode = async () => {
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('quick-settings-button')));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('quick-video-mode')));
  };

  // The first reply holds, so everything sent next queues behind it.
  h.boundary.llama!.scriptCompletion({ text: 'First reply.', holdBeforeStream: true });
  await h.tapSend('what is the weather like');
  await rtl.waitFor(() => expect(view.queryByTestId('stop-button')).not.toBeNull(), { timeout: 4000 });

  await h.tapSend('how deep is the pond');
  await h.settle(30);
  await toggleVideoMode();
  await h.tapSend(CLIP);
  await h.settle(30);
  await toggleVideoMode();
  await h.tapSend('and how cold is it');
  await h.settle(50);
  // Nothing has left the queue while the first reply holds.
  expect(desktop.submissions).toHaveLength(0);
  expect(view.queryByText(COMBINED_REPLY)).toBeNull();

  h.boundary.llama!.scriptCompletion({ text: COMBINED_REPLY });
  h.boundary.llama!.releaseStream();

  // The two questions are answered in one reply.
  await rtl.waitFor(() => expect(view.getAllByText(COMBINED_REPLY)).toHaveLength(1), { timeout: 8000 });
  // The clip is made from the description alone.
  await rtl.waitFor(() => expect(desktop!.submissions).toHaveLength(1), { timeout: 8000 });
  expect(desktop.submissions[0].prompt).toBe(CLIP);
});
