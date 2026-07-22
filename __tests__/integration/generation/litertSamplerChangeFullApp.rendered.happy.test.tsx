/** P1 #48 — a live LiteRT conversation applies each rendered Top P change. */
import type { DownloadedModel } from '../../../src/types';
import {
  closeAppSheet,
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

type Journey = Awaited<ReturnType<typeof renderMainApp>>;

const liteRTModel: DownloadedModel = {
  id: 'test/sampler-change/sampler-change.litertlm',
  name: 'Sampler Change Model',
  author: 'test',
  fileName: 'sampler-change.litertlm',
  filePath: '/docs/models/sampler-change.litertlm',
  fileSize: 128 * 1024 * 1024,
  quantization: 'LiteRT',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'litert',
  liteRTVision: false,
};

async function setLiteRTTopP(journey: Journey, value: string): Promise<void> {
  const { rtl, view } = journey;

  rtl.fireEvent.press(view.getByTestId('chat-settings-icon'));
  await rtl.waitFor(() => expect(view.getByText('Chat Settings')).toBeTruthy());
  if (!view.queryByTestId('modal-text-advanced-toggle')) {
    rtl.fireEvent.press(view.getByText('TEXT GENERATION'));
  }
  const advancedToggle = await rtl.waitFor(() =>
    view.getByTestId('modal-text-advanced-toggle'),
  );
  if (!view.queryByTestId('setting-liteRTTopP-value-button')) {
    rtl.fireEvent.press(advancedToggle);
  }
  rtl.fireEvent.press(
    await rtl.waitFor(() =>
      view.getByTestId('setting-liteRTTopP-value-button'),
    ),
  );
  const input = view.getByTestId('setting-liteRTTopP-input');
  rtl.fireEvent.changeText(input, value);
  rtl.fireEvent(input, 'submitEditing');
  await rtl.waitFor(() =>
    expect(view.getByTestId('setting-liteRTTopP-value')).toHaveTextContent(
      Number(value).toFixed(2),
    ),
  );
  await closeAppSheet(journey, 'Chat Settings');
}

function latestReset(journey: Journey): unknown[] {
  const reset = journey.boundary.litert.calls.resetConversation.at(-1);
  expect(reset).toBeTruthy();
  return reset!;
}

describe('P1 full-app LiteRT sampler-change journey', () => {
  it('resets the live conversation with each Top P value and preserves visible history', async () => {
    const journey = await renderMainApp({
      downloadedModels: [liteRTModel],
    });
    const { boundary, rtl, view } = journey;

    await openChatWithJourneyModel(rtl, view);
    await setLiteRTTopP(journey, '0.25');
    boundary.litert.scriptTurn({
      content: 'The first sampling configuration answered.',
    });
    sendChatMessage(rtl, view, 'Use the first sampler value');
    await rtl.waitFor(
      () => {
        expect(
          view.getByText('The first sampling configuration answered.'),
        ).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );

    const firstReset = latestReset(journey);
    expect(firstReset[3]).toBe(0.25);
    const resetsAfterFirstTurn = boundary.litert.calls.resetConversation.length;

    // LiteRT owns sampler state natively. Reconfiguring Top P in the same live
    // conversation must force a fresh reset instead of reusing its cached setup.
    await setLiteRTTopP(journey, '0.85');
    boundary.litert.scriptTurn({
      content: 'The updated sampler replaced the prior value.',
    });
    sendChatMessage(rtl, view, 'Use the changed sampler value');
    await rtl.waitFor(
      () => {
        expect(
          view.getByText('The updated sampler replaced the prior value.'),
        ).toBeTruthy();
        expect(
          view.getByText('The first sampling configuration answered.'),
        ).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('voice-loading')).toBeNull();
      },
      { timeout: 8000 },
    );

    expect(boundary.litert.calls.resetConversation.length).toBeGreaterThan(
      resetsAfterFirstTurn,
    );
    const secondReset = latestReset(journey);
    expect(secondReset[3]).toBe(0.85);
    expect(secondReset[3]).not.toBe(firstReset[3]);

    view.unmount();
  }, 30000);
});
