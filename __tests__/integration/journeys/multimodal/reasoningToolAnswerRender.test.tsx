/**
 * MULTIMODAL TURN JOURNEY (cluster B): a turn that REASONS, calls a tool, then answers must render
 * the three artifacts IN ORDER — pre-tool thinking box, the tool card, and (in a later message) the
 * post-tool answer — with NO raw model markup ever visible.
 *
 * This drives the REAL ChatMessage renderer through the SINGLE parse seam (buildMessageData →
 * parseModelOutput). The terminal artifacts asserted are on-screen (getByText / getByTestId), across
 * BOTH reasoning transports:
 *   - separate reasoning channel (litert / remote): message.reasoningContent + tool markup in content
 *   - inline <think> (llama): <think>…</think> then tool markup, both in content
 * The pre-tool reasoning is the OD14 killer-demo feature: it must survive on the tool-call message.
 * The answer invariant (parseModelOutput.answer is markup-free BY CONSTRUCTION) is what stops the
 * tool-call-leak class — deleting the parse or the reasoning wiring must fail these.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { ChatMessage } from '../../../../src/components/ChatMessage';
import { createMessage } from '../../../utils/factories';
import type { Message } from '../../../../src/types';

const toolMarkup =
  '<tool_call>\n<function=web_search>\n<parameter=query>\ncapital of France\n</parameter>\n</function>\n</tool_call>';

/** A full turn's three assistant-side messages, exactly as the tool loop persists them. */
function turn(opts: { channel: boolean }): { toolCallMsg: Message; toolResultMsg: Message; answerMsg: Message } {
  const preToolReasoning = 'The user asked for the capital of France. I should search.';
  const toolCallMsg = createMessage({
    role: 'assistant',
    content: opts.channel ? toolMarkup : `<think>${preToolReasoning}</think>\n${toolMarkup}`,
    ...(opts.channel ? { reasoningContent: preToolReasoning } : {}),
    toolCalls: [{ id: 't1', name: 'web_search', arguments: '{"query":"capital of France"}' }],
  } as any);
  const toolResultMsg = createMessage({
    role: 'tool', toolName: 'web_search', toolCallId: 't1',
    content: 'Paris is the capital of France.',
  });
  const answerMsg = createMessage({ role: 'assistant', content: 'The capital of France is Paris.' });
  return { toolCallMsg, toolResultMsg, answerMsg };
}

describe.each([
  { channel: true, label: 'separate reasoning channel (litert/remote)' },
  { channel: false, label: 'inline <think> (llama)' },
])('reasoning → tool call → answer renders in order — $label', ({ channel }) => {
  it('renders the pre-tool thinking box, the tool card, and NO raw markup on the tool-call message', () => {
    const { toolCallMsg } = turn({ channel });
    // showActions off + not streaming so the collapsed thinking preview text is shown.
    const { getByTestId, queryByText } = render(<ChatMessage message={toolCallMsg} />);

    // Terminal artifact 1: the tool card renders (this IS a tool-call message).
    expect(getByTestId('tool-call-message')).toBeTruthy();
    // Terminal artifact 2: the pre-tool reasoning is shown (collapsed preview slice), not lost.
    expect(queryByText(/The user asked for the capital of France/)).toBeTruthy();
    // Terminal artifact 3: NO raw tool-call markup leaks as visible text.
    expect(queryByText(/<function=|<parameter=|<tool_call>/)).toBeNull();
  });

  it('renders the tool RESULT card with the web-search label (body behind the accordion)', () => {
    const { toolResultMsg } = turn({ channel });
    const { getByTestId } = render(<ChatMessage message={toolResultMsg} />);
    expect(getByTestId('tool-message')).toBeTruthy();
    // Terminal artifact: the default-visible label for a web_search result. The full result body
    // ("Paris is the capital of France.") lives behind the collapsible accordion (numberOfLines=2).
    expect(getByTestId('tool-result-label-web_search').props.children.join('')).toContain('Web search result');
  });

  it('renders the POST-tool answer as a clean assistant message', () => {
    const { answerMsg } = turn({ channel });
    const { getByTestId, queryByText } = render(<ChatMessage message={answerMsg} />);
    expect(getByTestId('assistant-message')).toBeTruthy();
    expect(queryByText(/The capital of France is Paris\./)).toBeTruthy();
    expect(queryByText(/<function=|<parameter=|<tool_call>|<think>/)).toBeNull();
  });
});
