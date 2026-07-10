/**
 * RED-FLOW (UI, rendered) — Q3 at the pixel: mount the REAL ChatMessage on the tool-result the pipeline
 * produced. A stringified `arguments` payload makes the calculator fail, so the tool-result bubble the
 * user sees shows an internal error instead of the answer (4). Real llmService + toolLoop + calculator
 * over the faked llama.rn + FS; renders the real bubble.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import type { Message } from '../../../src/types';

describe('Q3 (rendered) — stringified tool args surface an error bubble', () => {
  it('renders a calculator result bubble with the answer, not an internal error', async () => {
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

    boundary.llama!.scriptCompletion({ text: 'Calculating. <tool_call>{"name": "calculator", "arguments": "{\\"expression\\": \\"2+2\\"}"}</tool_call>' });

    const conversationId = useChatStore.getState().createConversation('llm');
    useChatStore.getState().addMessage(conversationId, { role: 'user', content: 'what is 2 + 2' });
    await generationService.generateWithTools(conversationId, useChatStore.getState().getConversationMessages(conversationId), { enabledToolIds: ['calculator'] });

    const messages: Message[] = useChatStore.getState().getConversationMessages(conversationId);
    const toolMsg = messages.find(m => m.role === 'tool' && m.toolName === 'calculator');
    expect(toolMsg).toBeDefined(); // the tool ran (unlike Q2's drop)

    const { queryByText } = render(React.createElement(ChatMessage, { message: toolMsg as Message }));

    // Correct: the bubble shows the computed answer. Today the stringified args break the tool, so the
    // bubble shows an internal failure → RED.
    expect(queryByText(/failed \(internal\)|Cannot read properties/)).toBeNull();
    expect(queryByText(/\b4\b/)).not.toBeNull();
  });
});
