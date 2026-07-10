/**
 * RED-FLOW (UI, rendered) — Q2 at the pixel: a tool call with unquoted-key JSON is dropped, so the user
 * sees NO tool-result bubble (the tool silently never ran). Real llmService + toolLoop + calculator over
 * faked llama.rn + memfs; renders the REAL ChatMessage for each turn.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import type { Message } from '../../../src/types';

describe('Q2 (rendered) — unquoted-key tool call renders no result bubble', () => {
  it('renders a calculator tool-result bubble even when the model emits an unquoted key', async () => {
    const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * 1024 ** 3, availBytes: 8 * 1024 ** 3 } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render } = requireRTL();
    const { llmService } = require('../../../src/services/llm');
    const { generationService } = require('../../../src/services/generationService');
    const { hardwareService } = require('../../../src/services/hardware');
    const { useAppStore, useChatStore } = require('../../../src/stores');
    const { ChatMessage } = require('../../../src/components/ChatMessage');
    /* eslint-enable @typescript-eslint/no-var-requires */

    boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
    await hardwareService.refreshMemoryInfo();
    await llmService.loadModel('/models/small.gguf');
    useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama' })], activeModelId: 'llm' });

    boundary.llama!.scriptCompletion({ text: 'Calculating. <tool_call>{"name": "calculator", "arguments": {expression: "2+2"}}</tool_call>' });

    const conversationId = useChatStore.getState().createConversation('llm');
    useChatStore.getState().addMessage(conversationId, { role: 'user', content: 'what is 2 + 2' });
    await generationService.generateWithTools(conversationId, useChatStore.getState().getConversationMessages(conversationId), { enabledToolIds: ['calculator'] });

    const messages: Message[] = useChatStore.getState().getConversationMessages(conversationId);
    const view = render(
      React.createElement(React.Fragment, null, ...messages.map((m, i) => React.createElement(ChatMessage, { key: i, message: m }))),
    );

    // Proof the render happened: the user's message is on screen.
    expect(view.queryByText(/what is 2 \+ 2/)).not.toBeNull();
    // Correct: the calculator ran, so its result bubble is shown. Today the unquoted-key call is dropped
    // → no tool-result bubble at all → RED.
    expect(view.queryByTestId('tool-result-label-calculator')).not.toBeNull();
  });
});
