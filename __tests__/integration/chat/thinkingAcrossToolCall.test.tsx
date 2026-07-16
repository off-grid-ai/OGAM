/**
 * GUARD (UI integration) — reasoning survives a tool-call turn: when a LiteRT model streams reasoning,
 * calls a tool, then answers, the user sees BOTH the thinking and the final answer in the bubble
 * (relevant to the parse-once reasoning work). Real generationService + toolLoop + real calculator +
 * liteRTService over the faked LiteRTModule; renders the REAL ChatMessage the pipeline produced.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import type { Message } from '../../../src/types';

describe('thinking across a tool-call turn (guard)', () => {
  it('shows the streamed reasoning AND the final answer after a tool call', async () => {
    const boundary = installNativeBoundary({ ram: { platform: 'android', totalBytes: 12 * 1024 ** 3, availBytes: 8 * 1024 ** 3 } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render } = requireRTL();
    const { liteRTService } = require('../../../src/services/litert');
    const { generationService } = require('../../../src/services/generationService');
    const { useAppStore, useChatStore } = require('../../../src/stores');
    const { ChatMessage } = require('../../../src/components/ChatMessage');
    /* eslint-enable @typescript-eslint/no-var-requires */

    await liteRTService.loadModel('/models/gemma.litertlm', 'gpu', { maxNumTokens: 4096 });
    useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'lrt', engine: 'litert' })], activeModelId: 'lrt' });
    const conversationId = useChatStore.getState().createConversation('lrt');
    useChatStore.getState().addMessage(conversationId, { role: 'user', content: 'what is 2+2' });

    boundary.litert.scriptTurn({
      reasoning: 'Let me compute this with the calculator.',
      toolCalls: [{ name: 'calculator', arguments: { expression: '2+2' } }],
      content: 'The answer is 4.',
    });

    await generationService.generateWithTools(
      conversationId,
      useChatStore.getState().getConversationMessages(conversationId),
      { enabledToolIds: ['calculator'] },
    );

    const messages: Message[] = useChatStore.getState().getConversationMessages(conversationId);
    const assistant = [...messages].reverse().find(m => m.role === 'assistant');
    const { queryByText } = render(React.createElement(ChatMessage, { message: assistant as Message, showGenerationDetails: false }));

    // The reasoning is preserved + shown, and the final answer renders — the thinking isn't lost across
    // the tool call.
    expect(queryByText(/Let me compute this with the calculator/)).not.toBeNull();
    expect(queryByText(/The answer is 4\./)).not.toBeNull();
  });
});
