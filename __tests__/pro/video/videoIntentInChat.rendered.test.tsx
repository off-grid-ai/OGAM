/**
 * Asking for a video in chat makes one, without the video toggle.
 *
 * SPEC (device check, 2026-11-04): "Create a video of a lighthouse at night." got a text answer
 * ("I can't create videos…"). Only the video toggle made a clip; the auto route knew image and text.
 * Now a message that leads with a making verb and names a video goes to video, as "draw a…" goes to
 * image; a question about video is still answered in text.
 *
 * Real ChatScreen, router, generation service and Pro's video service. Fakes only at the boundaries:
 * the llama.rn engine and Off Grid Desktop's video gateway at fetch.
 */
import React from 'react';
import { setupChatScreen } from '../../harness/chatHarness';
import {
  DESKTOP_VIDEO_ENDPOINT,
  DESKTOP_VIDEO_MODEL,
  serveDesktopVideoJobs,
  type DesktopVideoJobs,
} from '../../harness/desktopVideoServer';

jest.unmock('@react-navigation/native');

let desktop: DesktopVideoJobs | undefined;

afterEach(() => {
  desktop?.restore();
  desktop = undefined;
  require('../../../src/stores/remoteServerStore').useRemoteServerStore.getState().clearAllServers();
});

async function chatWithVideoModel() {
  const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'android' });
  desktop = serveDesktopVideoJobs(h.boundary.fs!);
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
  const picker = h.rtl.render(React.createElement(RemoteModelOptionsSection, { category: 'video' }));
  h.rtl.fireEvent.press(picker.getByTestId(rowId));
  await h.rtl.waitFor(() => expect(picker.getByTestId(rowId).props.accessibilityState?.selected).toBe(true));
  picker.unmount();
  await require('../../harness/proHarness').installPro();
  h.render();
  return h;
}

it('"Create a video of…" makes a clip with the toggle off', async () => {
  const h = await chatWithVideoModel();
  await h.tapSend('Create a video of a lighthouse at night.');
  await h.rtl.waitFor(() => expect(desktop!.submissions).toHaveLength(1), { timeout: 8000 });
  expect(desktop!.submissions[0].prompt).toContain('lighthouse at night');
  await h.rtl.waitFor(() => expect(h.view!.getByTestId('chat-clip-card')).toBeTruthy(), { timeout: 8000 });
  expect(h.boundary.llama!.calls.completion).toHaveLength(0); // no text reply instead of the clip
});

it('a question about video is answered in text and makes no clip', async () => {
  const h = await chatWithVideoModel();
  h.boundary.llama!.scriptCompletion({ text: 'Plan the shots, then film in good light.' });
  await h.tapSend('How do I make a video for my channel?');
  await h.rtl.waitFor(() => expect(h.view!.getByText('Plan the shots, then film in good light.')).toBeTruthy(), { timeout: 8000 });
  expect(desktop!.submissions).toHaveLength(0);
});

it('the router reads requests, not mentions', () => {
  const { isVideoRequest } = require('../../../src/services/intentClassifier');
  for (const ask of ['Create a video of a lighthouse at night.', 'make a short clip of waves', 'Can you generate a video showing a fox',
    'animate a paper boat drifting', 'please render an animation of rain', 'a video of a cat on a sofa'])
    expect([ask, isVideoRequest(ask)]).toEqual([ask, true]);
  for (const ask of ['How do I make a video?', 'summarize this video', 'what is a good video editor', 'I made a video yesterday',
    'draw a lighthouse', 'explain how animation works'])
    expect([ask, isVideoRequest(ask)]).toEqual([ask, false]);
});
