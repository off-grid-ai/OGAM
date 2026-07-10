/**
 * HAPPY-PATH (UI integration) — first message on a llama.cpp (GGUF) model renders the model's answer.
 *
 * Fakes ONLY the native llama.rn leaf + memfs (the .gguf on disk) + the RAM sensor. The REAL llmService,
 * generationService, generationToolLoop, and chatStore run; the REAL ChatMessage is rendered and asserted.
 * Mirror of chatNormalSend (litert) on the llama engine — the mainline text-gen floor for llama.cpp.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import type { Message } from '../../../src/types';

describe('happy — first message on a llama.cpp model', () => {
  it('renders the assistant answer for a normal send', async () => {
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

    const conversationId = useChatStore.getState().createConversation('llm');
    useChatStore.getState().addMessage(conversationId, { role: 'user', content: 'what is the capital of France' });

    boundary.llama!.scriptCompletion({ text: 'The capital of France is Paris.' });
    await generationService.generateWithTools(conversationId, useChatStore.getState().getConversationMessages(conversationId), { enabledToolIds: [] });

    const messages: Message[] = useChatStore.getState().getConversationMessages(conversationId);
    const view = render(React.createElement(React.Fragment, null, ...messages.map((m, i) => React.createElement(ChatMessage, { key: i, message: m }))));

    expect(view.queryByText(/what is the capital of France/)).not.toBeNull(); // render happened
    expect(view.queryByText(/The capital of France is Paris\./)).not.toBeNull(); // the answer is shown
  });
});
