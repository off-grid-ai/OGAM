/**
 * INTEGRATION — the reasoning pipeline through its REAL seams, end to end.
 *
 * This is the test that proves the parse-once refactor actually works for a user, not that a
 * mock returned what it was told. It drives the REAL chatStore (streaming → finalize) and the
 * REAL ChatMessage render, with NOTHING mocked in the parse path, and asserts the observable
 * outcome: reasoning is captured, the visible answer is clean, and raw model markup NEVER
 * reaches the screen. It reproduces the two bugs this refactor closes:
 *   - DR1  — remote channel reasoning leaking into the answer (streamed-split flow)
 *   - OD14 / tool-call leak — raw <tool_call>/<function=…> markup shown as text
 * for every format in the single-source grammar. A wall of green unit tests could not catch a
 * wiring bug between stream → store → render; this can.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { useChatStore } from '../../../src/stores/chatStore';
import { ChatMessage } from '../../../src/components/ChatMessage';
import { REASONING_DELIMITERS } from '../../../src/utils/messageContent';
import { ThinkTagParser } from '../../../src/services/providers/openAICompatibleStream';
import { resetStores, getChatState } from '../../utils/testHelpers';
import type { Message } from '../../../src/types';

const REASONING = 'let me weigh the options carefully';
const ANSWER = 'Here is the clean answer.';

/** Read the single assistant message the store just finalized into the active conversation. */
function finalizedMessage(convId: string): Message {
  const msg = getChatState()
    .conversations.find(c => c.id === convId)
    ?.messages.at(-1);
  if (!msg) throw new Error('no finalized message');
  return msg;
}

describe('reasoning pipeline — stream → finalize → render, real seams', () => {
  beforeEach(() => resetStores());

  describe.each(REASONING_DELIMITERS)(
    'format opened by %j',
    ({ open, close }) => {
      const raw = `${open}${REASONING}${close}${ANSWER}`;

      it('LOCAL flow: inline-tagged content is split into reasoning + clean answer, and renders both', () => {
        const store = useChatStore.getState();
        const convId = store.createConversation('local-model');
        store.startStreaming(convId);
        // Local (llama.rn) path: raw tokens accumulate in streamingMessage; reasoning is extracted
        // at finalize by the ONE shared parser.
        store.appendToStreamingMessage(raw);
        store.finalizeStreamingMessage(convId);

        const msg = finalizedMessage(convId);
        expect(msg.reasoningContent).toBe(REASONING);
        expect(msg.content).toBe(ANSWER);
        // The stored answer carries none of the opener/closer markup.
        expect(msg.content).not.toContain(open.trim());
        expect(msg.content).not.toContain(close.trim());

        const { getByText, queryByText } = render(
          <ChatMessage message={msg} />,
        );
        expect(getByText(ANSWER)).toBeTruthy(); // clean answer is visible
        expect(getByText(new RegExp(REASONING.slice(0, 20)))).toBeTruthy(); // reasoning survived into the block
        expect(
          queryByText(
            new RegExp(open.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          ),
        ).toBeNull(); // no raw markup on screen
      });

      it('REMOTE flow: ThinkTagParser split → store → finalize keeps reasoning out of the answer (DR1)', () => {
        const store = useChatStore.getState();
        const convId = store.createConversation('remote-model');
        store.startStreaming(convId);
        // Remote (OpenAI-compatible) path: the streaming parser routes reasoning vs answer live,
        // feeding the two store channels. Same grammar, different seam.
        const parser = new ThinkTagParser();
        parser.process(
          raw,
          t => useChatStore.getState().appendToStreamingMessage(t),
          r => useChatStore.getState().appendToStreamingReasoningContent(r),
        );
        store.finalizeStreamingMessage(convId);

        const msg = finalizedMessage(convId);
        expect(msg.reasoningContent).toBe(REASONING);
        expect(msg.content).toBe(ANSWER);

        const { getByText, queryByText } = render(
          <ChatMessage message={msg} />,
        );
        expect(getByText(ANSWER)).toBeTruthy();
        expect(
          queryByText(
            new RegExp(open.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          ),
        ).toBeNull();
      });
    },
  );

  it('tool-call markup never reaches the stored answer or the screen (OD14 / leak class)', () => {
    const store = useChatStore.getState();
    const convId = store.createConversation('local-model');
    store.startStreaming(convId);
    // A model that emits its answer wrapped around raw tool-call markup. After finalize the
    // stored content — and everything rendered — must be free of that markup.
    store.appendToStreamingMessage(
      'Sure, checking that.<tool_call><function=get_weather><parameter=city>NYC</parameter></function></tool_call>',
    );
    store.finalizeStreamingMessage(convId);

    const msg = finalizedMessage(convId);
    expect(msg.content).not.toContain('<tool_call>');
    expect(msg.content).not.toContain('<function=');
    expect(msg.content).not.toContain('<parameter=');

    const { queryByText } = render(<ChatMessage message={msg} />);
    expect(queryByText(/<tool_call>/)).toBeNull();
    expect(queryByText(/<function=/)).toBeNull();
    expect(queryByText(/<parameter=/)).toBeNull();
  });
});
