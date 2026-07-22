import type { RenderedAppJourney } from './appJourney';

export const REMOTE_SERVER_NAME = 'My LM Studio';
export const REMOTE_ENDPOINT = 'http://localhost:1234';
export const REMOTE_MODEL_ID = 'llama-3-8b';

/** Seed only the remote HTTP discovery boundary used by the real server form/store. */
export function installRemoteDiscoveryBoundary(capabilities?: {
  supportsThinking?: boolean;
  supportsToolCalling?: boolean;
}): void {
  globalThis.fetch = async input => {
    const url = String(input);
    if (capabilities && url.endsWith('/api/v1/models')) {
      return new Response(
        JSON.stringify({
          models: [
            {
              key: REMOTE_MODEL_ID,
              max_context_length: 8192,
              capabilities: {
                vision: false,
                trained_for_tool_use: capabilities.supportsToolCalling === true,
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    if (url.endsWith('/v1/models')) {
      return new Response(
        JSON.stringify({
          object: 'list',
          data: [{ id: REMOTE_MODEL_ID, object: 'model', owned_by: 'local' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    if (capabilities && url.endsWith('/v1/chat/completions')) {
      const reasoningDelta = capabilities.supportsThinking
        ? 'data: {"choices":[{"delta":{"reasoning_content":"Thinking"}}]}\n\n'
        : 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n';
      return new Response(`${reasoningDelta}data: [DONE]\n\n`, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

/** Open Home's text-model picker whether Home is empty or already has a selection. */
export async function openTextModelPickerThroughHome(
  rtl: RenderedAppJourney['rtl'],
  view: RenderedAppJourney['view'],
): Promise<void> {
  const browseModels = view.queryByTestId('browse-models-button');
  if (browseModels) {
    rtl.fireEvent.press(browseModels);
    return;
  }

  rtl.fireEvent.press(view.getByTestId('models-summary'));
  const textRow = await rtl.waitFor(() => view.getByTestId('models-row-text'));
  rtl.fireEvent.press(textRow);
}

/** Configure, save, select, and open a remote chat using only rendered App gestures. */
export async function openRemoteChatThroughApp(
  rtl: RenderedAppJourney['rtl'],
  view: RenderedAppJourney['view'],
): Promise<void> {
  rtl.fireEvent.press(view.getByTestId('settings-tab'));
  await rtl.waitFor(() =>
    expect(view.getByText('Remote Servers')).toBeTruthy(),
  );
  rtl.fireEvent.press(view.getByText('Remote Servers'));
  await rtl.waitFor(() =>
    expect(view.getByText('No Remote Servers')).toBeTruthy(),
  );

  rtl.fireEvent.press(view.getByText('Add Server'));
  rtl.fireEvent.changeText(
    await rtl.waitFor(() =>
      view.getByPlaceholderText('e.g., Off Grid AI Desktop'),
    ),
    REMOTE_SERVER_NAME,
  );
  rtl.fireEvent.changeText(
    view.getByPlaceholderText('http://192.168.1.50:7878'),
    REMOTE_ENDPOINT,
  );
  rtl.fireEvent.press(view.getByText('Test Connection'));
  await rtl.waitFor(() => expect(view.getByText(/Connected \(/)).toBeTruthy(), {
    timeout: 5000,
  });
  const addButtons = view.getAllByText('Add Server');
  rtl.fireEvent.press(addButtons[addButtons.length - 1]);
  await rtl.waitFor(() => {
    expect(view.getByText(REMOTE_SERVER_NAME)).toBeTruthy();
    expect(view.getByText('Connected')).toBeTruthy();
  });

  rtl.fireEvent.press(view.getByTestId('remote-servers-back-button'));
  await rtl.waitFor(() =>
    expect(view.getByTestId('settings-tab')).toBeTruthy(),
  );
  rtl.fireEvent.press(view.getByTestId('home-tab'));
  await rtl.waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());

  // An empty Home exposes the direct Browse button. When a local model is
  // already selected, the same text picker lives behind the Models manager.
  // Keep the shared journey faithful to both real UI states instead of forcing
  // callers to clear the local selection outside the product.
  await openTextModelPickerThroughHome(rtl, view);
  await rtl.waitFor(() => {
    expect(view.getByText(REMOTE_SERVER_NAME)).toBeTruthy();
    expect(view.getByText(REMOTE_MODEL_ID)).toBeTruthy();
    expect(view.getByTestId('remote-model-item')).toBeTruthy();
  });
  rtl.fireEvent.press(view.getByTestId('remote-model-item'));
  await rtl.waitFor(
    () => expect(view.getByTestId('new-chat-button')).toBeTruthy(),
    { timeout: 5000 },
  );
  rtl.fireEvent.press(view.getByTestId('new-chat-button'));
  await rtl.waitFor(() => expect(view.getByTestId('chat-screen')).toBeTruthy());
}
