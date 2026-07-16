/**
 * GUARD (UI integration) — the manual "speak" button is fed ONLY the answer content, not the model's
 * thinking (a separate reasoningContent channel) nor tool-call markup. Renders the REAL MessageRenderer
 * and captures the exact text handed to the Speak slot. (Complements Q19, which is RED because markdown
 * is NOT stripped; here we lock that thinking + tool-call markup ARE excluded.)
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { createMessage } from '../../utils/factories';

describe('speak excludes thinking + tool-call data (guard)', () => {
  it('hands the speaker the answer only — no reasoning channel, no tool-call markup', () => {
    installNativeBoundary();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render } = requireRTL();
    const { MessageRenderer } = require('../../../src/screens/ChatScreen/MessageRenderer');
    const { registerSlot, SLOTS } = require('../../../src/bootstrap/slotRegistry');
    const { useUiModeStore } = require('../../../src/stores/uiModeStore');
    /* eslint-enable @typescript-eslint/no-var-requires */

    let spoken = '';
    registerSlot(SLOTS.messageSpeakButton, ({ text }: { text: string }) => { spoken = text; return null; });
    useUiModeStore.setState({ interfaceMode: 'text' as never });

    const message = createMessage({
      role: 'assistant',
      content: 'The capital of France is Paris. <tool_call>{"name":"web_search","arguments":{}}</tool_call>',
      reasoningContent: 'The user asked about France; I should recall its capital.',
      isStreaming: false,
    });

    render(
      React.createElement(MessageRenderer, {
        item: message, index: 0, displayMessagesLength: 1, animateLastN: 0, imageModelLoaded: false,
        isStreaming: false, isGeneratingImage: false, showGenerationDetails: false,
        onCopy: () => {}, onRetry: () => {}, onEdit: () => {}, onGenerateImage: () => {}, onImagePress: () => {},
      }),
    );

    expect(spoken).toContain('Paris');                 // the answer is spoken
    expect(spoken).not.toMatch(/tool_call/);           // no tool-call markup
    expect(spoken).not.toMatch(/should recall/);       // no reasoning-channel content
  });
});
