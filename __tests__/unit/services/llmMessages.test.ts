/**
 * llmMessages Unit Tests
 *
 * Tests for message formatting helpers (OAI message building, llama prompt formatting).
 * Focus: isSystemInfo filtering, image attachment handling, tool call formatting.
 */

import {
  formatLlamaMessages,
  buildOAIMessages,
  extractImageUris,
} from '../../../src/services/llmMessages';
import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createMessage,
  createImageAttachment,
} from '../../utils/factories';
import type { Message } from '../../../src/types';

// ==========================================================================
// formatLlamaMessages
// ==========================================================================

describe('formatLlamaMessages', () => {
  it('formats a basic user/assistant exchange', () => {
    const messages: Message[] = [
      createSystemMessage('You are helpful.'),
      createUserMessage('Hello'),
      createAssistantMessage('Hi there!'),
    ];

    const result = formatLlamaMessages(messages, false);

    expect(result).toContain('<|im_start|>system\nYou are helpful.<|im_end|>');
    expect(result).toContain('<|im_start|>user\nHello<|im_end|>');
    expect(result).toContain('<|im_start|>assistant\nHi there!<|im_end|>');
    // Should end with the assistant start tag for generation
    expect(result).toMatch(/<\|im_start\|>assistant\n$/);
  });

  it('filters out messages with isSystemInfo: true', () => {
    const messages: Message[] = [
      createSystemMessage('You are helpful.'),
      createUserMessage('Hello'),
      createMessage({ role: 'assistant', content: 'Model info here', isSystemInfo: true }),
      createAssistantMessage('Real response'),
    ];

    const result = formatLlamaMessages(messages, false);

    expect(result).not.toContain('Model info here');
    expect(result).toContain('Real response');
  });

  it('includes messages where isSystemInfo is undefined or false', () => {
    const messages: Message[] = [
      createMessage({ role: 'user', content: 'no flag' }),
      createMessage({ role: 'user', content: 'explicit false', isSystemInfo: false }),
    ];

    const result = formatLlamaMessages(messages, false);

    expect(result).toContain('no flag');
    expect(result).toContain('explicit false');
  });

  it('adds image markers when supportsVision is true', () => {
    const messages: Message[] = [
      createUserMessage('Describe this', {
        attachments: [createImageAttachment({ uri: 'file:///img.jpg' })],
      }),
    ];

    const result = formatLlamaMessages(messages, true);

    expect(result).toContain('<__media__>Describe this');
  });

  it('does not add image markers when supportsVision is false', () => {
    const messages: Message[] = [
      createUserMessage('Describe this', {
        attachments: [createImageAttachment({ uri: 'file:///img.jpg' })],
      }),
    ];

    const result = formatLlamaMessages(messages, false);

    expect(result).not.toContain('<__media__>');
    expect(result).toContain('Describe this');
  });

  it('returns only the assistant start tag for an empty message list', () => {
    const result = formatLlamaMessages([], false);
    expect(result).toBe('<|im_start|>assistant\n');
  });

  it('filters out multiple isSystemInfo messages', () => {
    const messages: Message[] = [
      createMessage({ role: 'assistant', content: 'sys1', isSystemInfo: true }),
      createMessage({ role: 'assistant', content: 'sys2', isSystemInfo: true }),
      createUserMessage('real question'),
    ];

    const result = formatLlamaMessages(messages, false);

    expect(result).not.toContain('sys1');
    expect(result).not.toContain('sys2');
    expect(result).toContain('real question');
  });
});

// ==========================================================================
// buildOAIMessages
// ==========================================================================

describe('buildOAIMessages', () => {
  it('converts basic messages to OAI format', () => {
    const messages: Message[] = [
      createSystemMessage('System prompt'),
      createUserMessage('Hello'),
      createAssistantMessage('Hi'),
    ];

    const result = buildOAIMessages(messages);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ role: 'system', content: 'System prompt' });
    expect(result[1]).toEqual({ role: 'user', content: 'Hello' });
    expect(result[2]).toEqual({ role: 'assistant', content: 'Hi' });
  });

  it('filters out messages with isSystemInfo: true', () => {
    const messages: Message[] = [
      createSystemMessage('System prompt'),
      createUserMessage('Hello'),
      createMessage({ role: 'assistant', content: 'System info card', isSystemInfo: true }),
      createAssistantMessage('Real reply'),
    ];

    const result = buildOAIMessages(messages);

    expect(result).toHaveLength(3);
    expect(result.map(m => m.content)).not.toContain('System info card');
    expect(result[2]).toEqual({ role: 'assistant', content: 'Real reply' });
  });

  it('includes messages where isSystemInfo is undefined or false', () => {
    const messages: Message[] = [
      createMessage({ role: 'user', content: 'no flag' }),
      createMessage({ role: 'user', content: 'explicit false', isSystemInfo: false }),
    ];

    const result = buildOAIMessages(messages);

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('no flag');
    expect(result[1].content).toBe('explicit false');
  });

  it('returns an empty array when all messages are isSystemInfo', () => {
    const messages: Message[] = [
      createMessage({ role: 'assistant', content: 'info1', isSystemInfo: true }),
      createMessage({ role: 'assistant', content: 'info2', isSystemInfo: true }),
    ];

    const result = buildOAIMessages(messages);

    expect(result).toHaveLength(0);
  });

  it('formats user messages with image attachments as content parts', () => {
    const messages: Message[] = [
      createUserMessage('What is this?', {
        attachments: [createImageAttachment({ uri: 'file:///photo.jpg' })],
      }),
    ];

    const result = buildOAIMessages(messages);

    expect(result).toHaveLength(1);
    expect(Array.isArray(result[0].content)).toBe(true);
    const parts = result[0].content as any[];
    expect(parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'image_url' }),
        expect.objectContaining({ type: 'text', text: 'What is this?' }),
      ]),
    );
  });

  it('prepends file:// to image URIs that lack a scheme', () => {
    const messages: Message[] = [
      createUserMessage('Describe', {
        attachments: [createImageAttachment({ uri: '/data/user/0/com.localllm/cache/photo.jpg' })],
      }),
    ];

    const result = buildOAIMessages(messages);
    const parts = result[0].content as any[];
    const imageUrlPart = parts.find((p: any) => p.type === 'image_url');

    expect(imageUrlPart.image_url.url).toBe('file:///data/user/0/com.localllm/cache/photo.jpg');
  });

  it('flattens tool result messages into user messages with labels', () => {
    const messages: Message[] = [
      createMessage({
        role: 'tool',
        content: '{"result": 42}',
        toolCallId: 'call_123',
        toolName: 'calculator',
      }),
    ];

    const result = buildOAIMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        role: 'user',
        content: '[Tool Result: calculator]\n{"result": 42}\n[End Tool Result]',
      }),
    );
  });

  it('flattens assistant tool calls into plain text content', () => {
    const messages: Message[] = [
      createMessage({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'search', arguments: '{"q":"test"}' }],
      }),
    ];

    const result = buildOAIMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        content: '<tool_call>{"name":"search","arguments":{"q":"test"}}</tool_call>',
      }),
    );
    // No structured tool_calls — avoids Jinja/C++ conflicts
    expect((result[0] as any).tool_calls).toBeUndefined();
  });
});

// ==========================================================================
// extractImageUris
// ==========================================================================

describe('extractImageUris', () => {
  it('extracts image URIs from messages with attachments', () => {
    const messages: Message[] = [
      createUserMessage('Look', {
        attachments: [
          createImageAttachment({ uri: 'file:///a.jpg' }),
          createImageAttachment({ uri: 'file:///b.png' }),
        ],
      }),
      createUserMessage('No attachments'),
    ];

    const uris = extractImageUris(messages);

    expect(uris).toEqual(['file:///a.jpg', 'file:///b.png']);
  });

  it('returns an empty array when no images are present', () => {
    const messages: Message[] = [createUserMessage('Hello')];
    expect(extractImageUris(messages)).toEqual([]);
  });

  it('does not filter out isSystemInfo messages (extracts all images)', () => {
    const messages: Message[] = [
      createMessage({
        role: 'assistant',
        content: 'info',
        isSystemInfo: true,
        attachments: [createImageAttachment({ uri: 'file:///sys.jpg' })],
      }),
    ];

    // extractImageUris does NOT filter isSystemInfo — it extracts from all messages
    const uris = extractImageUris(messages);
    expect(uris).toEqual(['file:///sys.jpg']);
  });
});

// ==========================================================================
// B5/B9 regression: PRODUCT RULE — every voice note is transcribed and ONLY the transcript is sent
// to the model; audio is NEVER model input. Sending the audio (a) is redundant with the transcript
// and (b) hard-fails the turn ("Failed to load media" on a non-audio mmproj; "File does not exist"
// when the absolute iOS container path went stale after a reinstall). So NO audio attachment — with
// or without a transcript — is ever attached as media.
// ==========================================================================

describe('voice-note audio is NEVER sent as model media — transcript-only (B5/B9)', () => {
  const transcribedVoiceNote = (uri: string, transcript: string) =>
    ({ id: `a-${uri}`, type: 'audio' as const, uri, audioFormat: 'wav' as const, textContent: transcript });
  const rawAudio = (uri: string) =>
    ({ id: `a-${uri}`, type: 'audio' as const, uri, audioFormat: 'wav' as const });

  it('formatLlamaMessages: a transcribed voice note adds NO audio media marker (even with supportsAudio)', () => {
    const messages: Message[] = [
      createUserMessage('spoken text', { attachments: [transcribedVoiceNote('file:///vn.wav', 'spoken text')] }),
    ];
    const result = formatLlamaMessages(messages, false, true);
    expect(result).not.toContain('<__media__>');
    expect(result).toContain('spoken text');
  });

  it('formatLlamaMessages: even a transcript-LESS audio (whisper not ready) is NOT sent as media', () => {
    const messages: Message[] = [
      createUserMessage('', { attachments: [rawAudio('file:///raw.wav')] }),
    ];
    expect(formatLlamaMessages(messages, false, true)).not.toContain('<__media__>');
  });

  it('buildOAIMessages: a transcribed voice note stays a plain text message (no input_audio part)', () => {
    const messages: Message[] = [
      createUserMessage('spoken text', { attachments: [transcribedVoiceNote('file:///vn.wav', 'spoken text')] }),
    ];
    const [msg] = buildOAIMessages(messages, true);
    expect(msg).toEqual({ role: 'user', content: 'spoken text' }); // text, not a media-parts array
  });

  it('buildOAIMessages: a voice note NEVER produces an input_audio part (the B9 file-not-found fix)', () => {
    const messages: Message[] = [
      createUserMessage('spoken text', { attachments: [rawAudio('file:///raw.wav')] }),
    ];
    const [msg] = buildOAIMessages(messages, true);
    // Text-only (or, if there were an image, no input_audio in the parts) — never input_audio.
    const parts = Array.isArray(msg.content) ? (msg.content as any[]) : [];
    expect(parts.some(p => p.type === 'input_audio')).toBe(false);
    if (!Array.isArray(msg.content)) expect(msg.content).toBe('spoken text');
  });
});
