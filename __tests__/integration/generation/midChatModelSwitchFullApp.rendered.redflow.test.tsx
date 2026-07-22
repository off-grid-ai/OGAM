/**
 * P1 #185 — switching between two downloaded text models inside an existing chat must update the live
 * screen without a Home round-trip, preserve the transcript, and route the next turn only to the new
 * native context. The models expose different native reasoning capabilities, making a stale Chat
 * projection visible through the real quick-settings UI.
 *
 * The real App, navigation, model manager/picker, local load/unload, capability derivation, generation
 * paths, stores, and rendered transcript run. Only the native llama runtime is faked.
 */
import { renderMainApp, sendChatMessage } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';
import type { DownloadedModel } from '../../../src/types';

const FIRST_PROMPT = 'What is the capital of France?';
const FIRST_REPLY = 'Paris is the capital of France.';
const SECOND_PROMPT = 'Answer this turn with the newly selected model.';
const SECOND_REPLY = 'The second local model answered this turn.';

const FIRST_MODEL: DownloadedModel = {
  id: 'test/gemma-first/gemma-first.litertlm',
  name: 'Gemma First LiteRT',
  author: 'test',
  fileName: 'gemma-first.litertlm',
  filePath: '/docs/models/gemma-first.litertlm',
  fileSize: 128 * 1024 * 1024,
  quantization: 'LiteRT',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'litert',
  liteRTVision: false,
};

const SECOND_MODEL: DownloadedModel = {
  id: 'test/mistral-local/mistral-local-Q4_K_M.gguf',
  name: 'Mistral Local',
  author: 'test',
  fileName: 'mistral-local-Q4_K_M.gguf',
  filePath: '/docs/models/mistral-local-Q4_K_M.gguf',
  fileSize: 128 * 1024 * 1024,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
};

const PLAIN_MISTRAL_TEMPLATE =
  "{{ bos_token }}{% for message in messages %}{% if message['role'] == 'user' %}[INST] {{ message['content'] }} [/INST]{% else %}{{ message['content'] }}{% endif %}{% endfor %}";

describe('P1 #185 full-App mid-chat model switch coherence', () => {
  it('keeps the transcript and sends the next turn only through the newly selected local model', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
      downloadedModels: [FIRST_MODEL, SECOND_MODEL],
    });

    rtl.fireEvent.press(view.getByTestId('browse-models-button'));
    const homeRows = await rtl.waitFor(() => {
      const rows = view.getAllByTestId('model-item');
      expect(rows).toHaveLength(2);
      return rows;
    });
    rtl.fireEvent.press(homeRows[0]);
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('new-chat-button')),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );
    await rtl.act(async () => {
      rtl.fireEvent.press(view.getByTestId('model-selector'));
    });
    await rtl.waitFor(() => {
      expect(view.getByTestId('models-row-text')).toHaveTextContent(
        /Gemma First LiteRT/,
      );
    });
    await rtl.act(async () => {
      rtl.fireEvent.press(view.getByText('Done'));
    });
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-input')).toBeTruthy(),
    );
    boundary.litert.scriptTurn({ content: FIRST_REPLY });
    sendChatMessage(rtl, view, FIRST_PROMPT);
    await rtl.waitFor(
      () => {
        expect(view.getAllByText(FIRST_PROMPT).length).toBeGreaterThan(0);
        expect(view.getByText(FIRST_REPLY)).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 8000 },
    );
    expect(boundary.litert.calls.sendMessage.map(call => call[0])).toEqual([
      'Hi',
      FIRST_PROMPT,
    ]);

    // Loaded LiteRT exposes native thinking; the second model deliberately does not.
    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('quick-thinking-toggle')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('quick-tools'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('tools-back-button')),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-screen')).toBeTruthy(),
    );

    // The second GGUF's native metadata carries no reasoning delimiter. This is external runtime truth,
    // not an Off Grid capability decision; the real service must derive and publish the change.
    boundary.llama!.setModelChatTemplate(
      SECOND_MODEL.filePath,
      PLAIN_MISTRAL_TEMPLATE,
    );

    // Switch through the same Models manager and Text picker a user opens mid-conversation.
    rtl.fireEvent.press(view.getByTestId('model-selector'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('models-row-text')),
    );
    const secondRow = await rtl.waitFor(() =>
      view.getByTestId(`text-model-row-${SECOND_MODEL.id}`),
    );
    rtl.fireEvent.press(secondRow);

    await rtl.waitFor(
      () => expect(boundary.llama!.module.initLlama).toHaveBeenCalled(),
      { timeout: 15000 },
    );
    await rtl.waitFor(
      () => expect(view.queryByText('Select Model')).toBeNull(),
      { timeout: 15000 },
    );

    // The live screen—not a remounted Chat—must now project the second model and its capabilities.
    rtl.fireEvent.press(view.getByTestId('model-selector'));
    const activeTextRow = await rtl.waitFor(() =>
      view.getByTestId('models-row-text'),
    );
    expect(rtl.within(activeTextRow).getByText(SECOND_MODEL.name)).toBeTruthy();
    await rtl.act(async () => {
      rtl.fireEvent.press(view.getByText('Done'));
    });
    await rtl.waitFor(() =>
      expect(view.getByTestId('chat-input')).toBeTruthy(),
    );

    rtl.fireEvent.press(view.getByTestId('quick-settings-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('quick-tools')).toBeTruthy(),
    );
    expect(view.queryByTestId('quick-thinking-toggle')).toBeNull();
    // Close through the popover overlay's real press surface.
    rtl.fireEvent.press(view.getByTestId('quick-tools'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('tools-back-button')),
    );

    boundary.llama!.scriptCompletion({ text: SECOND_REPLY });
    sendChatMessage(rtl, view, SECOND_PROMPT);
    await rtl.waitFor(
      () => {
        expect(view.getAllByText(FIRST_PROMPT).length).toBeGreaterThan(0);
        expect(view.getByText(FIRST_REPLY)).toBeTruthy();
        expect(view.getAllByText(SECOND_PROMPT).length).toBeGreaterThan(0);
        expect(view.getByText(SECOND_REPLY)).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('queue-indicator')).toBeNull();
      },
      { timeout: 8000 },
    );

    // Boundary cross-check: A was released, B was loaded, and each visible reply used exactly one context.
    const textLoads = boundary
      .llama!.module.initLlama.mock.calls.map(
        call => call[0] as { model?: string; embedding?: boolean },
      )
      .filter(request => !request.embedding);
    expect(textLoads.map(request => request.model)).toEqual([
      SECOND_MODEL.filePath,
    ]);
    expect(boundary.litert.module.unloadModel).toHaveBeenCalled();
    expect(boundary.litert.calls.sendMessage.map(call => call[0])).toEqual([
      'Hi',
      FIRST_PROMPT,
    ]);
    expect(boundary.llama!.calls.completion).toHaveLength(1);

    view.unmount();
  }, 60000);
});
