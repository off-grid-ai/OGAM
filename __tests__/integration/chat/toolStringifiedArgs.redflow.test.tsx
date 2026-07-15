/**
 * RED-FLOW (integration) — Q3: a tool call whose `arguments` is a STRINGIFIED JSON object is passed
 * through as a raw string instead of being normalized to an object, so the tool receives no usable
 * parameters. Small models emit `"arguments":"{...}"` (a string) routinely; parseToolCallBody
 * (generationToolLoop.ts:51) forwards `parsed.arguments` verbatim, so the tool gets a string and its
 * parameter reads come back undefined.
 *
 * Integration boundary: only llama.rn (scripted completion) + the filesystem (the gguf) are faked. The
 * REAL llmService, tool loop, and calculator run. Observable outcome: the tool RESULT the user sees is
 * the real answer (4) vs a failed/empty result.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import type { Message } from '../../../src/types';

const ARGS_STRINGIFIED = '{"name": "calculator", "arguments": "{\\"expression\\": \\"2+2\\"}"}';
const ARGS_OBJECT = '{"name": "calculator", "arguments": {"expression": "2+2"}}';

async function toolResultContentFor(callBody: string): Promise<string> {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * 1024 ** 3, availBytes: 8 * 1024 ** 3 } });
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { llmService } = require('../../../src/services/llm');
  const { generationService } = require('../../../src/services/generationService');
  const { hardwareService } = require('../../../src/services/hardware');
  const { useAppStore, useChatStore } = require('../../../src/stores');
  /* eslint-enable @typescript-eslint/no-var-requires */

  boundary.fs!.seedFile('/models/small.gguf', 500 * 1024 * 1024);
  await hardwareService.refreshMemoryInfo();
  await llmService.loadModel('/models/small.gguf');
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'llm', engine: 'llama' })], activeModelId: 'llm' });

  boundary.llama!.scriptCompletion({ text: `Calculating. <tool_call>${callBody}</tool_call>` });

  const conversationId = useChatStore.getState().createConversation('llm');
  useChatStore.getState().addMessage(conversationId, { role: 'user', content: 'what is 2 + 2' });
  await generationService.generateWithTools(conversationId, useChatStore.getState().getConversationMessages(conversationId), { enabledToolIds: ['calculator'] });

  const messages: Message[] = useChatStore.getState().getConversationMessages(conversationId);
  const toolMsg = messages.find(m => m.role === 'tool' && m.toolName === 'calculator');
  return toolMsg?.content ?? '';
}

describe('Q3 — stringified tool arguments (red-flow)', () => {
  it('normalizes stringified arguments so the calculator gets the expression and returns 4', async () => {
    const content = await toolResultContentFor(ARGS_STRINGIFIED);
    // Correct: the "{...}" string is parsed to an object, the calculator computes 2+2. Today the string
    // is forwarded raw, calculator.arguments.expression is undefined → failed/empty result → RED.
    expect(content).toMatch(/4/);
  });

  it('control: with an object arguments the calculator returns 4 (proves the red tracks the payload shape)', async () => {
    const content = await toolResultContentFor(ARGS_OBJECT);
    expect(content).toMatch(/4/);
  });
});
