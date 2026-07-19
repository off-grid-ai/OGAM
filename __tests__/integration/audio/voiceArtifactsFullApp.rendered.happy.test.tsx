/** P2 #64/#65 — full-App Voice rendering regressions through the Pro extension contract. */
import { StyleSheet, Switch } from 'react-native';
import type { DownloadedModel } from '../../../src/types';
import {
  openVoiceChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
  type RenderedAppJourney,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const WHISPER_PATH = '/docs/whisper-models/ggml-tiny.en.bin';
const model: DownloadedModel = {
  id: 'test/voice-artifacts/voice-artifacts.litertlm',
  name: 'Voice Artifacts',
  author: 'test',
  filePath: '/docs/models/voice-artifacts.litertlm',
  fileName: 'voice-artifacts.litertlm',
  fileSize: 128 * 1024 * 1024,
  quantization: 'INT4',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'litert',
  liteRTVision: false,
};

async function renderVoiceJourney(): Promise<RenderedAppJourney> {
  const journey = await renderMainApp({
    boundary: {
      whisper: true,
      ram: { platform: 'android', totalBytes: 16 * GB, availBytes: 14 * GB },
    },
    downloadedModels: [model],
    beforeRender: ({ boundary }) => {
      boundary.fs!.seedFile(WHISPER_PATH, 75 * 1024 * 1024);
    },
  });
  await openVoiceChatWithJourneyModel(journey);
  return journey;
}

async function enterVoiceMode(journey: RenderedAppJourney): Promise<void> {
  const { rtl, view } = journey;
  rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByTestId('quick-tts-mode')),
  );
  await rtl.waitFor(() =>
    expect(view.getByTestId('voice-record-button-audio')).toBeTruthy(),
  );
}

async function loadVoiceModel(journey: RenderedAppJourney): Promise<void> {
  const { boundary, rtl, view } = journey;
  boundary.litert.scriptTurn({ content: 'Voice model ready.' });
  sendChatMessage(rtl, view, 'Reply when ready.');
  await rtl.waitFor(
    () => {
      expect(view.getByText('Voice model ready.')).toBeTruthy();
      expect(view.queryByTestId('stop-button')).toBeNull();
    },
    { timeout: 8000 },
  );
}

async function recordOnce(
  journey: RenderedAppJourney,
  transcript: string,
): Promise<void> {
  const { boundary, rtl, view } = journey;
  boundary.whisper!.setFileTranscript(transcript);
  rtl.fireEvent.press(view.getByTestId('voice-record-button-audio'));
  await rtl.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 250));
  });
  rtl.fireEvent.press(view.getByTestId('voice-record-button-audio'));
}

function flatStyle(node: {
  props?: { style?: unknown };
}): Record<string, unknown> {
  return (StyleSheet.flatten(node.props?.style as never) ?? {}) as Record<
    string,
    unknown
  >;
}

describe('P2 full-App Voice rendering artifacts', () => {
  it('#64 keeps a successful tool result without a markdown-only phantom bubble', async () => {
    const journey = await renderVoiceJourney();
    const { boundary, rtl, view } = journey;
    await loadVoiceModel(journey);

    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    const tools = await rtl.waitFor(() => view.getByTestId('quick-tools'));
    await rtl.waitFor(
      () => expect(rtl.within(tools).queryByText('N/A')).toBeNull(),
      { timeout: 8000 },
    );
    rtl.fireEvent.press(tools);
    const calculator = await rtl.waitFor(() =>
      view.getByTestId('tool-picker-row-calculator'),
    );
    rtl.fireEvent(
      rtl.within(calculator).UNSAFE_getByType(Switch),
      'valueChange',
      true,
    );
    rtl.fireEvent.press(view.getByTestId('tools-back-button'));
    await enterVoiceMode(journey);

    boundary.litert.scriptTurn({
      toolCalls: [{ name: 'calculator', arguments: { expression: '500*321' } }],
      content: '#',
    });
    const bubbleCountBeforeTurn =
      view.queryAllByTestId(/^audio-bubble-/).length;
    await recordOnce(journey, 'Use the calculator for 500 times 321');

    await rtl.waitFor(() => {
      expect(view.getByTestId('tool-result-label-calculator')).toBeTruthy();
      expect(view.getAllByTestId(/^audio-bubble-/)).toHaveLength(
        bubbleCountBeforeTurn + 1,
      );
      expect(
        rtl.within(view.getByTestId('chat-screen')).queryByText('#'),
      ).toBeNull();
    });
    view.unmount();
  }, 30000);

  it('#65 constrains a thinking reply to the left-aligned Voice bubble column', async () => {
    const journey = await renderVoiceJourney();
    const { boundary, rtl, view } = journey;
    await loadVoiceModel(journey);

    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('quick-thinking-toggle')),
    );
    rtl.fireEvent.press(view.getByTestId('quick-tts-mode'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('voice-record-button-audio')).toBeTruthy(),
    );

    boundary.litert.scriptTurn({
      reasoning: 'Shorter wavelengths scatter more strongly in air.',
      content: 'Blue light scatters more, so the sky appears blue.',
    });
    const bubbleCountBeforeTurn =
      view.queryAllByTestId(/^audio-bubble-/).length;
    await recordOnce(journey, 'Why is the sky blue?');

    await rtl.waitFor(() =>
      expect(view.getAllByTestId(/^audio-bubble-/)).toHaveLength(
        bubbleCountBeforeTurn + 2,
      ),
    );
    const thinking = view.getByTestId('thinking-block');
    const assistantBubble = view.getAllByTestId(/^audio-bubble-/).at(-1)!;
    const bubbleStyle = flatStyle(assistantBubble);
    let parent = thinking.parent;
    let wrapper: Record<string, unknown> = {};
    for (let depth = 0; parent && depth < 8; depth += 1) {
      const candidate = flatStyle(parent);
      if (candidate.width === bubbleStyle.width) {
        wrapper = candidate;
        break;
      }
      parent = parent.parent;
    }
    expect(bubbleStyle).toMatchObject({
      width: '88%',
      alignSelf: 'flex-start',
    });
    expect(wrapper).toMatchObject({ width: '88%', alignSelf: 'flex-start' });
    view.unmount();
  }, 30000);
});
