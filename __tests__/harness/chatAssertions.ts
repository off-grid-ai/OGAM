import type { RenderAPI } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

type TestingLibrary = typeof import('@testing-library/react-native');
type TextMatcher = string | RegExp;

export interface ChatAssertions {
  isUserMessageVisible(text: TextMatcher): boolean;
  isResponseVisible(text: TextMatcher): boolean;
  isResponseHidden(text: TextMatcher): boolean;
  isGeneratedImageVisible(): boolean;
  isGeneratedImageLoaded(): boolean;
  isGeneratedImageCaptionVisible(prompt: TextMatcher): boolean;
  isPromptEnhancementPartOfGeneratedImage(
    enhancedPrompt: TextMatcher,
    caption: TextMatcher,
  ): boolean;
  isThinkingVisible(): boolean;
  isPromptEnhancementVisible(): boolean;
  isAttachedPhotoVisible(): boolean;
  isAttachedDocumentVisible(): boolean;
  isToolCallVisible(toolName: string): boolean;
  isToolResultVisible(detail: TextMatcher): boolean;
  isVoicePlaybackControlVisible(): boolean;
  isVoiceTranscriptClickable(text: TextMatcher): Promise<boolean>;
  isSelectTextActionVisible(): boolean;
  isUserMessageEditorVisible(): boolean;
  isAssistantResponseEditorVisible(): boolean;
  isMessageEditorClosed(): boolean;
  isComposerEnabled(): boolean;
  isActionMenuVisible(): boolean;
  isChatErrorVisible(title: TextMatcher): boolean;
  isSendLoadingVisible(): boolean;
  isSendControlVisible(): boolean;
  isStopControlVisible(): boolean;
  isEditorTextVisible(text: string): boolean;
  isNewChatTitleVisible(): boolean;
  isFirstMessageUsedAsTitle(text: string): boolean;
  isDocumentNameVisible(name: TextMatcher): boolean;
  isAttachedPhotoClickable(): Promise<boolean>;
  isAttachedDocumentClickable(): Promise<boolean>;
  isToolCallClickable(
    toolName: string,
    visibleDetail: TextMatcher,
  ): Promise<boolean>;
}

async function pressAndObserve(
  rtl: TestingLibrary,
  target: ReactTestInstance,
  visibleOutcome: () => ReactTestInstance | null,
): Promise<boolean> {
  let pressable: ReactTestInstance | null = target;
  while (pressable && typeof pressable.props.onPress !== 'function') {
    pressable = pressable.parent;
  }
  if (!pressable) return false;
  await rtl.act(async () => {
    await pressable.props.onPress();
  });
  try {
    await rtl.waitFor(() => {
      expect(visibleOutcome()).not.toBeNull();
    });
    return true;
  } catch {
    return false;
  }
}

function isVisible(target: ReactTestInstance | null): boolean {
  if (!target) return false;
  try {
    expect(target).toBeVisible();
    return true;
  } catch {
    return false;
  }
}

/**
 * Queries and gestures for user-visible Chat outcomes. These methods never read stores,
 * component callbacks, call counts, or other implementation details.
 */
export function createChatAssertions(
  view: RenderAPI,
  rtl: TestingLibrary,
): ChatAssertions {
  return {
    isUserMessageVisible(text) {
      const messages = view.queryAllByTestId('user-message');
      if (!messages[0]) return false;
      return isVisible(rtl.within(messages[0]).queryByText(text));
    },

    isResponseVisible(text) {
      return isVisible(view.queryByText(text));
    },

    isResponseHidden(text) {
      return view.queryByText(text) === null;
    },

    isGeneratedImageVisible() {
      return view.queryByLabelText('Generated image loaded') !== null;
    },

    isGeneratedImageLoaded() {
      return view.queryByLabelText('Generated image loaded') !== null;
    },

    isGeneratedImageCaptionVisible(prompt) {
      return isVisible(view.queryByText(prompt));
    },

    isPromptEnhancementPartOfGeneratedImage(enhancedPrompt, caption) {
      const response = view
        .queryAllByTestId('assistant-message')
        .find(message =>
          rtl.within(message).queryByTestId('generated-image-content'),
        );
      if (!response) return false;
      const bubble = rtl.within(response).queryByTestId('message-bubble');
      if (!bubble) return false;
      const prompt = rtl.within(bubble).queryByText(enhancedPrompt);
      const captionNode = rtl.within(bubble).queryByText(caption);
      const generatedImage = rtl
        .within(bubble)
        .queryByTestId('generated-image-content');
      if (!prompt || !captionNode || !generatedImage) return false;
      const renderedNodes = bubble.findAll(() => true);
      return (
        renderedNodes.indexOf(prompt) < renderedNodes.indexOf(captionNode) &&
        renderedNodes.indexOf(captionNode) <
          renderedNodes.indexOf(generatedImage)
      );
    },

    isThinkingVisible() {
      return Boolean(
        view.queryByTestId('thinking-block') ??
          view.queryByTestId('thinking-indicator'),
      );
    },

    isPromptEnhancementVisible() {
      return view.queryByText('Enhanced prompt') !== null;
    },

    isAttachedPhotoVisible() {
      return view.queryByTestId(/^attachment-image-/) !== null;
    },

    isAttachedDocumentVisible() {
      return view.queryByTestId(/^document-preview-/) !== null;
    },

    isToolCallVisible(toolName) {
      return (
        view.queryByTestId(`tool-result-label-${toolName}`) !== null ||
        view.queryByTestId(`tool-result-accordion-${toolName}`) !== null
      );
    },

    isToolResultVisible(detail) {
      return isVisible(view.queryByText(detail));
    },

    isVoicePlaybackControlVisible() {
      const bubbles = view.queryAllByTestId(/^audio-bubble-/);
      const bubble = bubbles[bubbles.length - 1];
      if (!bubble) return false;
      const scoped = rtl.within(bubble);
      return ['Play', 'Pause', 'Stop'].some(
        label => scoped.queryByLabelText(label) !== null,
      );
    },

    async isVoiceTranscriptClickable(text) {
      const bubbles = view.queryAllByTestId(/^audio-bubble-/);
      const bubble = bubbles[bubbles.length - 1];
      if (!bubble) return false;
      const scoped = rtl.within(bubble);
      const hide = scoped.queryByText('Hide transcript');
      if (hide) {
        let pressable: ReactTestInstance | null = hide;
        while (pressable && typeof pressable.props.onPress !== 'function') {
          pressable = pressable.parent;
        }
        if (!pressable) return false;
        await rtl.act(async () => {
          await pressable.props.onPress();
        });
        await rtl.waitFor(() => expect(scoped.queryByText(text)).toBeNull());
      }
      const show = scoped.queryByText('Show transcript');
      if (!show) return false;
      return pressAndObserve(rtl, show, () => scoped.queryByText(text));
    },

    isSelectTextActionVisible() {
      return (
        view.queryByText('Select text') !== null ||
        view.queryByTestId('action-select-text') !== null
      );
    },

    isUserMessageEditorVisible() {
      return (
        isVisible(view.queryByPlaceholderText('Enter message...')) &&
        isVisible(view.queryByText('SAVE & RESEND'))
      );
    },

    isAssistantResponseEditorVisible() {
      return (
        isVisible(view.queryByPlaceholderText('Enter message...')) &&
        isVisible(view.queryByText('SAVE')) &&
        view.queryByText('SAVE & RESEND') === null
      );
    },

    isMessageEditorClosed() {
      return view.queryByPlaceholderText('Enter message...') === null;
    },

    isComposerEnabled() {
      const composer = view.queryByTestId('chat-input');
      if (!composer) return false;
      try {
        expect(composer).toBeEnabled();
        return true;
      } catch {
        return false;
      }
    },

    isActionMenuVisible() {
      return view.queryByTestId('action-menu') !== null;
    },

    isChatErrorVisible(title) {
      return isVisible(view.queryByText(title));
    },

    isSendLoadingVisible() {
      return isVisible(view.queryByTestId('send-loading-dots'));
    },

    isSendControlVisible() {
      return isVisible(view.queryByTestId('send-button'));
    },

    isStopControlVisible() {
      return isVisible(view.queryByTestId('stop-button'));
    },

    isEditorTextVisible(text) {
      const editor = view.queryByPlaceholderText('Enter message...');
      return editor?.props.value === text;
    },

    isNewChatTitleVisible() {
      return isVisible(view.queryByText('New Chat'));
    },

    isFirstMessageUsedAsTitle(text) {
      const copies = view.queryAllByText(text);
      return (
        copies.length === 2 &&
        copies.every(copy => isVisible(copy)) &&
        view.queryByText('New Conversation') === null
      );
    },

    isDocumentNameVisible(name) {
      return isVisible(view.queryByText(name));
    },

    async isAttachedPhotoClickable() {
      const photo = view.queryByTestId(/^attachment-image-/);
      if (!photo || view.queryByText('Close')) return false;
      const opened = await pressAndObserve(rtl, photo, () =>
        view.queryByText('Close'),
      );
      if (opened) rtl.fireEvent.press(view.getByText('Close'));
      return opened;
    },

    async isAttachedDocumentClickable() {
      const document = view.queryByTestId(/^document-preview-/);
      if (!document || view.queryByText('Close')) return false;
      const opened = await pressAndObserve(rtl, document, () =>
        view.queryByText('Close'),
      );
      if (opened) rtl.fireEvent.press(view.getByText('Close'));
      return opened;
    },

    async isToolCallClickable(toolName, visibleDetail) {
      const tool =
        view.queryByTestId(`tool-result-label-${toolName}`) ??
        view.queryByTestId(`tool-result-accordion-${toolName}`);
      if (!tool || view.queryByText(visibleDetail)) return false;
      const expanded = await pressAndObserve(rtl, tool, () =>
        view.queryByText(visibleDetail),
      );
      if (expanded) rtl.fireEvent.press(tool);
      return expanded;
    },
  };
}
