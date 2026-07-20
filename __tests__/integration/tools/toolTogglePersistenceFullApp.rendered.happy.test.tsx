/** APP-P2-006 — tool choices persist and each new turn reads the latest choice. */
import {
  openChatWithJourneyModel,
  relaunchMainApp,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import type { DownloadedModel } from '../../../src/types';

const STORAGE_KEY = 'local-llm-app-storage';
const TOOL_MODEL: DownloadedModel = {
  id: 'test/llama-3-tools/llama-3-tools-Q4_K_M.gguf',
  name: 'Llama 3 Tools',
  author: 'test',
  fileName: 'llama-3-tools-Q4_K_M.gguf',
  filePath: '/docs/models/llama-3-tools-Q4_K_M.gguf',
  fileSize: 128 * 1024 * 1024,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
};

async function openNewChat(
  app: Awaited<ReturnType<typeof renderMainApp>>,
): Promise<void> {
  if (app.view.queryByTestId('browse-models-button')) {
    await openChatWithJourneyModel(app.rtl, app.view);
    return;
  }
  app.rtl.fireEvent.press(app.view.getByTestId('new-chat-button'));
  await app.rtl.waitFor(() =>
    expect(app.view.getByTestId('chat-screen')).toBeTruthy(),
  );
}

async function openCalculatorToggle(
  app: Awaited<ReturnType<typeof renderMainApp>>,
) {
  const { Switch } = require('react-native') as typeof import('react-native');
  app.rtl.fireEvent.press(app.view.getByTestId('quick-settings-button'));
  const tools = await app.rtl.waitFor(() =>
    app.view.getByTestId('quick-tools'),
  );
  await app.rtl.waitFor(
    () => expect(app.rtl.within(tools).queryByText('N/A')).toBeNull(),
    { timeout: 8000 },
  );
  app.rtl.fireEvent.press(tools);
  const row = await app.rtl.waitFor(() =>
    app.view.getByTestId('tool-picker-row-calculator'),
  );
  return {
    row,
    toggle: () => app.rtl.within(row).UNSAFE_getByType(Switch),
  };
}

async function expectPersistedCalculator(
  app: Awaited<ReturnType<typeof renderMainApp>>,
  enabled: boolean,
) {
  await app.rtl.waitFor(async () => {
    const raw = await app.asyncStorage.getItem(STORAGE_KEY);
    const enabledTools = JSON.parse(raw ?? '{}').state?.settings?.enabledTools;
    expect(enabledTools?.includes('calculator')).toBe(enabled);
  });
}

function exposedToolNames(call: unknown[]): string[] {
  const params = call[0] as {
    tools?: Array<{ function?: { name?: string } }>;
  };
  return (params.tools ?? [])
    .map(tool => tool.function?.name)
    .filter((name): name is string => !!name);
}

describe('full-App tool toggle persistence', () => {
  it('keeps enable and disable choices across relaunches and applies the disable to the next turn', async () => {
    const first = await renderMainApp({
      boundary: { llama: true },
      downloadedModels: [TOOL_MODEL],
    });
    await openNewChat(first);
    const firstCalculator = await openCalculatorToggle(first);
    expect(firstCalculator.toggle().props.value).toBe(false);
    first.rtl.fireEvent(firstCalculator.toggle(), 'valueChange', true);
    await first.rtl.waitFor(() =>
      expect(firstCalculator.toggle().props.value).toBe(true),
    );
    await expectPersistedCalculator(first, true);
    first.view.unmount();

    const enabledLaunch = await relaunchMainApp({ boundary: { llama: true } });
    await openNewChat(enabledLaunch);
    const enabledCalculator = await openCalculatorToggle(enabledLaunch);
    expect(enabledCalculator.toggle().props.value).toBe(true);
    enabledLaunch.rtl.fireEvent.press(
      enabledLaunch.view.getByTestId('tools-back-button'),
    );

    enabledLaunch.boundary.llama!.scriptCompletions([
      {
        toolCalls: [{ name: 'calculator', arguments: { expression: '7*6' } }],
      },
      { text: 'Seven times six is 42.' },
    ]);
    sendChatMessage(
      enabledLaunch.rtl,
      enabledLaunch.view,
      'What is 7 times 6?',
    );
    await enabledLaunch.rtl.waitFor(
      () =>
        expect(
          enabledLaunch.view.getByText('Seven times six is 42.'),
        ).toBeTruthy(),
      { timeout: 8000 },
    );
    expect(
      enabledLaunch.boundary
        .llama!.calls.completion.slice(0, 2)
        .every(call => exposedToolNames(call).includes('calculator')),
    ).toBe(true);

    const disabledCalculator = await openCalculatorToggle(enabledLaunch);
    enabledLaunch.rtl.fireEvent(
      disabledCalculator.toggle(),
      'valueChange',
      false,
    );
    await enabledLaunch.rtl.waitFor(() =>
      expect(disabledCalculator.toggle().props.value).toBe(false),
    );
    await expectPersistedCalculator(enabledLaunch, false);
    enabledLaunch.view.unmount();

    const disabledLaunch = await relaunchMainApp({ boundary: { llama: true } });
    await openNewChat(disabledLaunch);
    const persistedDisabledCalculator = await openCalculatorToggle(
      disabledLaunch,
    );
    expect(persistedDisabledCalculator.toggle().props.value).toBe(false);
    disabledLaunch.rtl.fireEvent.press(
      disabledLaunch.view.getByTestId('tools-back-button'),
    );

    disabledLaunch.boundary.llama!.scriptCompletion({
      text: 'The calculator is not available on this turn.',
    });
    sendChatMessage(
      disabledLaunch.rtl,
      disabledLaunch.view,
      'Answer without using a tool.',
    );
    await disabledLaunch.rtl.waitFor(
      () =>
        expect(
          disabledLaunch.view.getByText(
            'The calculator is not available on this turn.',
          ),
        ).toBeTruthy(),
      { timeout: 8000 },
    );
    expect(
      exposedToolNames(disabledLaunch.boundary.llama!.calls.completion[0]),
    ).not.toContain('calculator');
    disabledLaunch.view.unmount();
  }, 60000);
});
