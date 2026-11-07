import React from 'react';
import { render } from '@testing-library/react-native';
import { ChatMessage } from '../../../src/components/ChatMessage';
import { createMessage } from '../../utils/factories';

// On-device regression: raw tool-call markup (<tool_call>/<function=NAME>/<parameter=X>) leaked
// as visible text below the thinking block. Terminal-artifact: assert the user sees NO markup,
// across BOTH the separate-reasoning-channel path and the inline-<think> path.
describe('ChatMessage — tool-call markup never renders as visible text', () => {
  const rawBlock =
    '<tool_call>\n<function=search_knowledge_base>\n<parameter=query>\nAchilles of Troy\n</parameter>\n</function>\n</tool_call>';

  it('reasoningContent path (separate channel): markup hidden, thinking + tool chip shown', () => {
    const m = createMessage({ role: 'assistant', content: rawBlock,
      reasoningContent: 'The user wants to know about Achilles.',
      toolCalls: [{ id: 't1', name: 'search_knowledge_base', arguments: '{"query":"Achilles of Troy"}' }] } as any);
    const { queryByText, getByText } = render(<ChatMessage message={m} />);
    expect(queryByText(/<function=|<parameter=|<tool_call>/)).toBeNull();
    expect(getByText(/The user wants to know about Achilles\./)).toBeTruthy();
  });

  it('inline <think> path: markup hidden after the reasoning block', () => {
    const m = createMessage({ role: 'assistant',
      content: `<think>reasoning here</think>\n${rawBlock}`,
      toolCalls: [{ id: 't1', name: 'search_knowledge_base', arguments: '{}' }] } as any);
    const { queryByText } = render(<ChatMessage message={m} />);
    expect(queryByText(/<function=|<parameter=|<tool_call>/)).toBeNull();
  });
});
