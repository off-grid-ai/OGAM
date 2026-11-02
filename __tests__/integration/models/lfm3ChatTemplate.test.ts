/**
 * LFM3 turns are formatted by LFM3's own chat template, not by plain ChatML.
 *
 * The template is the real `tokenizer.chat_template` of LiquidAI/LFM3-1.7B-GGUF
 * (LFM3-1.7B-Q4_K_M.gguf at bad5729b, the file the catalog pins), read from the GGUF header.
 *
 * On the phone, llama.rn b12032 formats chat with llama.cpp's Jinja engine. Its common/chat sends
 * this template to the Qwen3-Coder handler (it has <tool_call>, <function= and <parameter=). That
 * handler renders the template itself, opens reasoning with <think>, and ignores the
 * {% generation %} tags (common/jinja/parser.cpp). Here the same template renders through the
 * reference Jinja engine, with the generation tags dropped the same way, from the exact messages,
 * tools and thinking switch the app sends.
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { Template } from '@huggingface/jinja';
import { buildOAIMessages, formatLlamaMessages } from '../../../src/services/llmMessages';
import { buildThinkingCompletionParams } from '../../../src/services/llmHelpers';
import { templateEmitsReasoning } from '../../../src/utils/messageContent';
import { createMessage } from '../../utils/factories';

const TEMPLATE = fs.readFileSync(path.join(__dirname, '../../fixtures/lfm3/LFM3-1.7B.chat_template.jinja'), 'utf8');

/** llama.cpp's Jinja parser skips {% generation %} / {% endgeneration %} (a transformers-only tag). */
const asLlamaCppParses = (source: string) => source.replace(/\{%-?\s*(?:end)?generation\s*-?%\}/g, '');

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Weather for a city',
      parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
    },
  },
];

const conversation = [
  createMessage({ role: 'system', content: 'Be brief.' }),
  createMessage({ role: 'user', content: 'Hi' }),
  createMessage({ role: 'assistant', content: 'Hello!' }),
  createMessage({ role: 'user', content: 'Weather in Paris?' }),
];

function render(thinking: boolean, withTools = true): string {
  const { enable_thinking } = buildThinkingCompletionParams(thinking);
  return new Template(asLlamaCppParses(TEMPLATE)).render({
    messages: buildOAIMessages(conversation),
    tools: withTools ? tools : undefined,
    add_generation_prompt: true,
    enable_thinking,
    bos_token: '<|startoftext|>',
  });
}

describe('LFM3 chat formatting', () => {
  it('uses the template the GGUF ships', () => {
    expect(createHash('sha256').update(TEMPLATE).digest('hex')).toBe('f45005c50cd2a97329722bf3a2dee9f16c04cdf825a589b280fb7e99e6827818');
    // What llama.cpp b12032 keys its Qwen3-Coder handler on, and its reasoning switch.
    for (const marker of ['<tool_call>', '<function=', '<parameter=', '<think>']) expect(TEMPLATE).toContain(marker);
  });

  it('offers the Thinking toggle, because the template reasons', () => {
    expect(templateEmitsReasoning(TEMPLATE)).toBe(true);
  });

  it('opens a <think> block when Thinking is on', () => {
    expect(render(true).endsWith('<|im_start|>assistant\n<think>')).toBe(true);
  });

  it('closes thinking before the answer when Thinking is off', () => {
    expect(render(false).endsWith('<|im_start|>assistant\n<think></think>')).toBe(true);
  });

  it("puts the app's tools in the system turn, in the template's own block", () => {
    const prompt = render(true);
    expect(prompt.startsWith('<|startoftext|><|im_start|>system\nBe brief.')).toBe(true);
    expect(prompt).toContain('<tools>\n{"name": "get_weather", "description": "Weather for a city"');
    expect(render(true, false)).not.toContain('<tools>');
  });

  it("marks earlier answers as finished thinking, the way the model was trained", () => {
    expect(render(true)).toContain('<|im_start|>assistant\n<think></think>Hello!<|im_end|>');
  });

  it('differs from the ChatML the app uses only to count tokens', () => {
    const chatml = formatLlamaMessages(conversation, false);
    expect(chatml).not.toContain('<think>');
    expect(chatml).not.toContain('<tools>');
    expect(render(false)).not.toBe(chatml);
  });
});
