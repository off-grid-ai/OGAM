/**
 * RED-FLOW (integration) — Q2: a tool call with unquoted-key JSON is silently dropped.
 *
 * A small GGUF model (llama engine) emits a tool call inside <tool_call>…</tool_call> whose JSON has an
 * unquoted key (what small models routinely produce). The standard parseToolCallBody path uses raw
 * JSON.parse with NO fixUnquotedKeys (generationToolLoop.ts:49-63), while the Gemma parser recovers via
 * fixUnquotedKeys (:106) — the two drifted, so the call is dropped and the tool never runs.
 *
 * Integration boundary: only llama.rn (scripted completion) + the filesystem (the gguf on disk) are
 * faked. The REAL llmService, generationToolLoop parsing, real calculator tool, and chatStore run. The
 * observable outcome is whether the calculator actually executed (a role:'tool' message in the store the
 * user then sees rendered).
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import type { Message } from '../../../src/types';

const CALL_BODY_UNQUOTED = '{"name": "calculator", "arguments": {expression: "2+2"}}';
const CALL_BODY_QUOTED = '{"name": "calculator", "arguments": {"expression": "2+2"}}';

async function runToolCallTurn(callBody: string): Promise<boolean> {
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

  boundary.llama!.scriptCompletion({ text: `Let me calculate. <tool_call>${callBody}</tool_call>` });

  const conversationId = useChatStore.getState().createConversation('llm');
  useChatStore.getState().addMessage(conversationId, { role: 'user', content: 'what is 2 + 2' });
  await generationService.generateWithTools(conversationId, useChatStore.getState().getConversationMessages(conversationId), { enabledToolIds: ['calculator'] });

  const messages: Message[] = useChatStore.getState().getConversationMessages(conversationId);
  return messages.some(m => m.role === 'tool' && m.toolName === 'calculator');
}

describe('Q2 — tool call with unquoted-key JSON (red-flow)', () => {
  it('runs the tool even when the small model emits an unquoted key (does not silently drop it)', async () => {
    // Correct: the calculator runs despite the unquoted key. Today parseToolCallBody's raw JSON.parse
    // drops it (no fixUnquotedKeys on the standard path) → RED.
    expect(await runToolCallTurn(CALL_BODY_UNQUOTED)).toBe(true);
  });

  it('control: with quoted JSON the calculator runs (proves the red tracks the parser, not the harness)', async () => {
    expect(await runToolCallTurn(CALL_BODY_QUOTED)).toBe(true);
  });
});
