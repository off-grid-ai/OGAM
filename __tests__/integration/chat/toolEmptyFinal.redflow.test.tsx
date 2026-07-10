/**
 * RED-FLOW (UI integration) — Q5: a successful tool + an empty final turn shows "(No response)".
 *
 * User flow: on a LiteRT model with the calculator tool enabled, the user asks a question; the model
 * emits a tool call, the tool returns real data, but the model's final turn is empty. The user should
 * see the answer built from the tool data — NOT a dead-end "(No response)" with the fetched data thrown
 * away (generationToolLoop.ts:722 emits the '_(No response)_' fallback and discards the tool result).
 *
 * Integration boundary: ONLY the native LiteRTModule is faked (via the shared harness, scripting a
 * device-shaped tool-call → respondToToolCall → empty-complete turn). The REAL generationService,
 * generationToolLoop, tool execution (real calculator), liteRTService, and chatStore all run. We then
 * render the REAL ChatMessage the pipeline produced and assert what the user sees.
 *
 * RED on HEAD: the assistant bubble renders "(No response)". Falsification: if the loop surfaced the
 * tool data instead, the "(No response)" text would be gone → green.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import type { Message } from '../../../src/types';

// NOTE: React, RNTL, and every product module are required AFTER installNativeBoundary() inside each
// test — installNativeBoundary calls jest.resetModules(), so anything imported at top (incl. the hoisted
// automatic-JSX runtime) would be a DIFFERENT React copy than the freshly-required component, giving a
// null hooks dispatcher. Requiring post-reset keeps one consistent module graph; createElement avoids
// re-introducing a hoisted jsx-runtime import.

describe('Q5 — successful tool + empty final turn (UI red-flow)', () => {
  it('does NOT leave the user on a dead-end "(No response)" when a tool returned data', async () => {
    const boundary = installNativeBoundary({ ram: { platform: 'android', totalBytes: 12 * 1024 ** 3, availBytes: 8 * 1024 ** 3 } });

    /* eslint-disable @typescript-eslint/no-var-requires */
    // Everything required AFTER seeding (post jest.resetModules) so React + RNTL + product modules
    // share ONE module graph.
    const React = require('react');
    const { render } = requireRTL();
    const { liteRTService } = require('../../../src/services/litert');
    const { generationService } = require('../../../src/services/generationService');
    const { useAppStore, useChatStore } = require('../../../src/stores');
    const { ChatMessage } = require('../../../src/components/ChatMessage');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // Real LiteRT model loaded (over the fake native) + active, so isLiteRTActive() + isModelLoaded().
    await liteRTService.loadModel('/models/gemma.litertlm', 'gpu', { maxNumTokens: 4096 });
    useAppStore.setState({
      downloadedModels: [createDownloadedModel({ id: 'lrt', engine: 'litert' })],
      activeModelId: 'lrt',
    });

    // A real conversation with the user's question.
    const conversationId = useChatStore.getState().createConversation('lrt');
    useChatStore.getState().addMessage(conversationId, { role: 'user', content: 'what is 2 + 2' });

    // Native model: emit a calculator tool call, then complete with NO content (the empty final turn).
    boundary.litert.scriptTurn({ toolCalls: [{ name: 'calculator', arguments: { expression: '2+2' } }], content: '' });

    await generationService.generateWithTools(
      conversationId,
      useChatStore.getState().getConversationMessages(conversationId),
      { enabledToolIds: ['calculator'] },
    );

    const messages: Message[] = useChatStore.getState().getConversationMessages(conversationId);
    const assistant = [...messages].reverse().find(m => m.role === 'assistant');
    expect(assistant).toBeDefined();

    const { queryByText } = render(React.createElement(ChatMessage, { message: assistant as Message }));

    // Correct behavior: the tool data reached the user, so there is no dead-end "(No response)".
    // Today: the bubble renders "(No response)" and the calculator result is discarded → RED.
    expect(queryByText(/\(No response\)/)).toBeNull();
  });

  // Falsification / control (GREEN): identical flow, but the model's final turn HAS content. This
  // proves the red above tracks REAL behavior — flip only the seeded final content and the outcome
  // flips too — so the red is the live bug, not a harness artifact.
  it('control: when the model DOES answer after the tool, the user sees the answer (no "(No response)")', async () => {
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
    useChatStore.getState().addMessage(conversationId, { role: 'user', content: 'what is 2 + 2' });

    boundary.litert.scriptTurn({ toolCalls: [{ name: 'calculator', arguments: { expression: '2+2' } }], content: 'The answer is 4.' });

    await generationService.generateWithTools(
      conversationId,
      useChatStore.getState().getConversationMessages(conversationId),
      { enabledToolIds: ['calculator'] },
    );

    const messages: Message[] = useChatStore.getState().getConversationMessages(conversationId);
    const assistant = [...messages].reverse().find(m => m.role === 'assistant');
    const { queryByText } = render(React.createElement(ChatMessage, { message: assistant as Message }));

    expect(queryByText(/\(No response\)/)).toBeNull();
    expect(queryByText(/The answer is 4\./)).not.toBeNull();
  });
});
