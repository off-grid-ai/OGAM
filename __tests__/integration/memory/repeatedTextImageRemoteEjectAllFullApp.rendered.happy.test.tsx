/**
 * P1 #209 — repeated local-text, local-image, and remote-text swaps keep one
 * coherent active selection, and Eject All clears every resident afterward.
 *
 * The real App, navigation, model pickers, generation services, provider
 * registry, residency policy, manager sheet, and eject owner stay real. Native
 * llama/diffusion/RAM/filesystem and remote HTTP streaming are boundaries.
 */
import type { RenderedAppJourney } from '../../harness/appJourney';
import {
  openChatWithJourneyModel,
  renderMainApp,
  seedDownloadedMnnImageModel,
  sendChatMessage,
} from '../../harness/appJourney';
import {
  installRemoteDiscoveryBoundary,
  openRemoteChatThroughApp,
  openTextModelPickerThroughHome,
  REMOTE_MODEL_ID,
} from '../../harness/fullAppRemoteJourney';
import { GB } from '../../harness/nativeBoundary';
import { installRemoteStream } from '../../harness/remoteHarness';

const originalFetch = globalThis.fetch;
const originalXMLHttpRequest = globalThis.XMLHttpRequest;

const remoteSse = (reply: string) =>
  `data: {"choices":[{"delta":{"content":"${reply}"}}]}\n\n` +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.XMLHttpRequest = originalXMLHttpRequest;
});

async function returnHome(app: RenderedAppJourney): Promise<void> {
  app.rtl.fireEvent.press(app.view.getByTestId('chat-back-button'));
  await app.rtl.waitFor(() =>
    expect(app.view.getByTestId('home-screen')).toBeTruthy(),
  );
}

async function openImageChat(app: RenderedAppJourney): Promise<void> {
  const { fireEvent, waitFor } = app.rtl;
  fireEvent.press(app.view.getByTestId('models-summary'));
  fireEvent.press(
    await waitFor(() => app.view.getByTestId('models-row-image')),
  );
  fireEvent.press(await waitFor(() => app.view.getByTestId('model-item')));
  fireEvent.press(await waitFor(() => app.view.getByTestId('new-chat-button')));
  await waitFor(() => expect(app.view.getByTestId('chat-screen')).toBeTruthy());
}

async function generateImage(
  app: RenderedAppJourney,
  prompt: string,
): Promise<void> {
  const { act, fireEvent, waitFor } = app.rtl;
  fireEvent.press(app.view.getByTestId('quick-settings-button'));
  fireEvent.press(
    await waitFor(() => app.view.getByTestId('quick-image-mode')),
  );
  const ReactNative = require('react-native') as typeof import('react-native');
  const quickSettings = app.view
    .UNSAFE_getAllByType(ReactNative.Modal)
    .find(modal => modal.props.visible);
  expect(quickSettings).toBeTruthy();
  await act(async () => fireEvent(quickSettings!, 'requestClose'));
  sendChatMessage(app.rtl, app.view, prompt);
  await waitFor(
    () => expect(app.view.getByTestId('generated-image')).toBeTruthy(),
    { timeout: 10000 },
  );
}

async function openConfiguredRemoteChat(
  app: RenderedAppJourney,
): Promise<void> {
  await openTextModelPickerThroughHome(app.rtl, app.view);
  await app.rtl.waitFor(() => {
    expect(app.view.getByText(REMOTE_MODEL_ID)).toBeTruthy();
    expect(app.view.getByTestId('remote-model-item')).toBeTruthy();
  });
  app.rtl.fireEvent.press(app.view.getByTestId('remote-model-item'));
  await app.rtl.waitFor(() =>
    expect(app.view.getByTestId('home-screen')).toBeTruthy(),
  );
  app.rtl.fireEvent.press(app.view.getByTestId('models-summary'));
  await app.rtl.waitFor(
    () => {
      expect(app.view.getByTestId('models-row-text')).toHaveTextContent(
        new RegExp(REMOTE_MODEL_ID),
      );
      expect(app.view.getByTestId('models-row-text-remote')).toBeTruthy();
      expect(app.view.queryByTestId('models-row-text-ram')).toBeNull();
    },
    { timeout: 15000 },
  );
  app.rtl.fireEvent.press(app.view.getByText('Done'));
  app.rtl.fireEvent.press(
    await app.rtl.waitFor(() => app.view.getByTestId('new-chat-button')),
  );
  await app.rtl.waitFor(() =>
    expect(app.view.getByTestId('chat-screen')).toBeTruthy(),
  );
}

async function openLocalChat(app: RenderedAppJourney): Promise<void> {
  await openTextModelPickerThroughHome(app.rtl, app.view);
  app.rtl.fireEvent.press(
    await app.rtl.waitFor(() => app.view.getByTestId('model-item')),
  );
  app.rtl.fireEvent.press(
    await app.rtl.waitFor(() => app.view.getByTestId('new-chat-button')),
  );
  await app.rtl.waitFor(() =>
    expect(app.view.getByTestId('chat-screen')).toBeTruthy(),
  );
}

async function assertRemoteOwnsTextRow(app: RenderedAppJourney): Promise<void> {
  app.rtl.fireEvent.press(app.view.getByTestId('model-selector'));
  await app.rtl.waitFor(
    () => {
      expect(app.view.getByTestId('models-row-text')).toHaveTextContent(
        new RegExp(REMOTE_MODEL_ID),
      );
      expect(app.view.getByTestId('models-row-text-remote')).toBeTruthy();
      expect(app.view.queryByTestId('models-row-text-ram')).toBeNull();
    },
    { timeout: 15000 },
  );
  app.rtl.fireEvent.press(app.view.getByText('Done'));
}

describe('P1 #209 repeated model swaps and final ejection', () => {
  it('cycles text, image, and remote twice, then leaves In Memory empty', async () => {
    installRemoteDiscoveryBoundary();
    const app = await renderMainApp({
      boundary: {
        llama: true,
        ram: {
          platform: 'android',
          totalBytes: 16 * GB,
          availBytes: 14 * GB,
        },
      },
      beforeRender: async ({ boundary, asyncStorage }) => {
        await seedDownloadedMnnImageModel(boundary, asyncStorage, {
          name: 'Swap Journey Image',
          size: 512 * 1024 * 1024,
        });
      },
    });
    const { boundary, rtl, view } = app;

    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({ text: 'Local cycle zero is ready.' });
    sendChatMessage(rtl, view, 'Start locally.');
    await rtl.waitFor(() =>
      expect(view.getByText('Local cycle zero is ready.')).toBeTruthy(),
    );
    await returnHome(app);

    await openImageChat(app);
    await generateImage(app, 'first image cycle');
    await returnHome(app);

    await openRemoteChatThroughApp(rtl, view);
    await assertRemoteOwnsTextRow(app);
    installRemoteStream(remoteSse('Remote cycle one is coherent.'));
    sendChatMessage(rtl, view, 'Answer remotely in cycle one.');
    await rtl.waitFor(() =>
      expect(view.getByText('Remote cycle one is coherent.')).toBeTruthy(),
    );
    await returnHome(app);

    await openLocalChat(app);
    boundary.llama!.scriptCompletion({ text: 'Local cycle one returned.' });
    sendChatMessage(rtl, view, 'Return locally in cycle one.');
    await rtl.waitFor(() =>
      expect(view.getByText('Local cycle one returned.')).toBeTruthy(),
    );
    await returnHome(app);

    await openImageChat(app);
    await generateImage(app, 'second image cycle');
    await returnHome(app);

    await openConfiguredRemoteChat(app);
    await assertRemoteOwnsTextRow(app);
    installRemoteStream(remoteSse('Remote cycle two is coherent.'));
    sendChatMessage(rtl, view, 'Answer remotely in cycle two.');
    await rtl.waitFor(() =>
      expect(view.getByText('Remote cycle two is coherent.')).toBeTruthy(),
    );
    await returnHome(app);

    await openLocalChat(app);
    boundary.llama!.scriptCompletion({ text: 'Local cycle two returned.' });
    sendChatMessage(rtl, view, 'Return locally in cycle two.');
    await rtl.waitFor(() =>
      expect(view.getByText('Local cycle two returned.')).toBeTruthy(),
    );

    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Journey Model/,
      );
      expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
      expect(view.getByTestId('models-row-image')).toHaveTextContent(
        /Swap Journey Image/,
      );
      expect(view.getByTestId('models-row-image-ram')).toBeTruthy();
      expect(view.queryByTestId('models-row-text-remote')).toBeNull();
    });

    rtl.fireEvent.press(view.getByText('Eject All Models'));
    await rtl.waitFor(() =>
      expect(
        view.getByText('Unload all active models to free up memory?'),
      ).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByText('Eject'));
    const doneMessage = await rtl.waitFor(
      () => view.getByText(/Unloaded [1-9]\d* models?/),
      { timeout: 20000 },
    );
    expect(doneMessage).toBeTruthy();
    rtl.fireEvent.press(view.getByText('OK'));

    rtl.fireEvent.press(view.getByTestId('model-selector'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Journey Model/,
      );
      expect(view.getByTestId('models-row-image')).toHaveTextContent(
        /Swap Journey Image/,
      );
      expect(view.queryByTestId('models-row-text-ram')).toBeNull();
      expect(view.queryByTestId('models-row-image-ram')).toBeNull();
      expect(view.queryByTestId('models-row-text-remote')).toBeNull();
    });

    view.unmount();
  }, 90000);
});
