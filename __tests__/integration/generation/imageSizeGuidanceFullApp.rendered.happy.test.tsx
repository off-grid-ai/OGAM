/** P1 #67/#69 — rendered image quality values reach each native generation. */
import {
  closeAppSheet,
  renderMainApp,
  seedDownloadedMnnImageModel,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

type Journey = Awaited<ReturnType<typeof renderMainApp>>;

async function setImageQuality(
  journey: Journey,
  size: string,
  steps: string,
  guidance: string,
): Promise<void> {
  const { rtl, view } = journey;

  rtl.fireEvent.press(view.getByTestId('chat-settings-icon'));
  await rtl.waitFor(() => expect(view.getByText('Chat Settings')).toBeTruthy());
  if (!view.queryByTestId('image-size-value-button')) {
    rtl.fireEvent.press(view.getByText('IMAGE GENERATION'));
  }

  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByTestId('image-size-value-button')),
  );
  const sizeInput = view.getByTestId('image-size-input');
  rtl.fireEvent.changeText(sizeInput, size);
  rtl.fireEvent(sizeInput, 'submitEditing');

  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByTestId('image-steps-value-button')),
  );
  const stepsInput = view.getByTestId('image-steps-input');
  rtl.fireEvent.changeText(stepsInput, steps);
  rtl.fireEvent(stepsInput, 'submitEditing');

  if (!view.queryByTestId('guidance-scale-value-button')) {
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('modal-image-advanced-toggle')),
    );
  }
  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByTestId('guidance-scale-value-button')),
  );
  const guidanceInput = view.getByTestId('guidance-scale-input');
  rtl.fireEvent.changeText(guidanceInput, guidance);
  rtl.fireEvent(guidanceInput, 'submitEditing');

  await rtl.waitFor(() => {
    expect(view.getByTestId('image-size-value')).toHaveTextContent(
      `${size}x${size}`,
    );
    expect(view.getByTestId('image-steps-value')).toHaveTextContent(steps);
    expect(view.getByTestId('guidance-scale-value')).toHaveTextContent(
      Number(guidance).toFixed(1),
    );
  });
  await closeAppSheet(journey, 'Chat Settings');
}

async function chooseOneTurnImageMode(journey: Journey): Promise<void> {
  const { rtl, view } = journey;

  rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByTestId('quick-image-mode')),
  );
  await rtl.waitFor(() =>
    expect(view.getByTestId('image-mode-force-badge')).toBeTruthy(),
  );

  const ReactNative = require('react-native') as typeof import('react-native');
  const visibleModal = view
    .UNSAFE_getAllByType(ReactNative.Modal)
    .find(modal => modal.props.visible);
  expect(visibleModal).toBeTruthy();
  await rtl.act(async () => {
    rtl.fireEvent(visibleModal!, 'requestClose');
  });
}

describe('P1 full-app image quality journey', () => {
  it('uses each rendered image configuration without a stale snapshot', async () => {
    const journey = await renderMainApp({
      boundary: {
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
      beforeRender: async ({ boundary, asyncStorage }) => {
        await seedDownloadedMnnImageModel(boundary, asyncStorage);
      },
    });
    const { boundary, rtl, view } = journey;

    rtl.fireEvent.press(view.getByTestId('models-summary'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('models-row-image')),
    );
    await rtl.waitFor(() =>
      expect(view.getByText('Journey Image')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('model-item'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('new-chat-button')),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );

    await setImageQuality(journey, '320', '12', '3.5');
    await chooseOneTurnImageMode(journey);
    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'a blue lantern');
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await rtl.waitFor(
      () => {
        expect(view.getAllByTestId('generated-image')).toHaveLength(1);
        expect(view.getByTestId('generated-image-content')).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );

    const firstRequest = boundary.diffusion.calls.generateImage.at(-1);
    expect(firstRequest).toEqual(
      expect.objectContaining({
        width: 320,
        height: 320,
        steps: 12,
        guidanceScale: 3.5,
      }),
    );
    const generationsAfterFirst = boundary.diffusion.calls.generateImage.length;

    // Change all controls in the same live Chat. The next image must read the
    // current rendered settings instead of retaining the first generation's values.
    await setImageQuality(journey, '448', '24', '11');
    await chooseOneTurnImageMode(journey);
    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'a red lantern');
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await rtl.waitFor(
      () => {
        expect(view.getAllByTestId('generated-image')).toHaveLength(2);
        expect(view.getAllByTestId('generated-image-content')).toHaveLength(2);
        expect(
          view.getByText(/Generated image for:.*a blue lantern/),
        ).toBeTruthy();
        expect(
          view.getByText(/Generated image for:.*a red lantern/),
        ).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );

    expect(boundary.diffusion.calls.generateImage.length).toBeGreaterThan(
      generationsAfterFirst,
    );
    const secondRequest = boundary.diffusion.calls.generateImage.at(-1);
    expect(secondRequest).toEqual(
      expect.objectContaining({
        width: 448,
        height: 448,
        steps: 24,
        guidanceScale: 11,
      }),
    );
    expect(secondRequest?.width).not.toBe(firstRequest?.width);
    expect(secondRequest?.steps).not.toBe(firstRequest?.steps);
    expect(secondRequest?.guidanceScale).not.toBe(firstRequest?.guidanceScale);

    view.unmount();
  }, 30000);
});
