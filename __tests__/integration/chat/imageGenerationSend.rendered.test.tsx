import {
  CHAT_IMAGE_GENERATION_SCENARIOS,
  startChatScreen,
} from '../../harness/chatHarness';

describe.each(CHAT_IMAGE_GENERATION_SCENARIOS)(
  'Mobile image generation send journey on $label',
  scenario => {
    it('shows the generated image and only shows a prompt rewrite when the scenario requires one', async () => {
      const h = await startChatScreen(scenario);
      const enhancedPrompt =
        'A green Lamborghini driving on a mountain road, detailed bodywork, natural light.';
      h.scriptImageTurnFor(scenario, {
        enhancedPrompt,
        thinkingText: 'Reasoning must never become an image prompt.',
      });
      await h.tapSend('Draw a green lamborghini');
      await h.rtl.waitFor(() => {
        expect(
          h.assertions.isUserMessageVisible('Draw a green lamborghini'),
        ).toBe(true);
      });

      await h.markGeneratedImageLoaded();
      await h.rtl.waitFor(() => {
        expect(h.assertions.isGeneratedImageVisible()).toBe(true);
        expect(h.assertions.isGeneratedImageLoaded()).toBe(true);
      });

      const expectsEnhancedPrompt = scenario.expectsEnhancedImagePrompt();
      expect(h.assertions.isPromptEnhancementVisible()).toBe(
        expectsEnhancedPrompt,
      );
      expect(
        h.assertions.isPromptEnhancementPartOfGeneratedImage(
          /green Lamborghini driving/i,
          /Generated image for:.*Draw a green lamborghini/,
        ),
      ).toBe(expectsEnhancedPrompt);
      expect(h.assertions.isResponseHidden(/green Lamborghini driving/i)).toBe(
        !expectsEnhancedPrompt,
      );
      expect(
        h.assertions.isResponseHidden(
          'Reasoning must never become an image prompt.',
        ),
      ).toBe(true);
      expect(
        h.assertions.isGeneratedImageCaptionVisible(
          /Generated image for:.*Draw a green lamborghini/,
        ),
      ).toBe(true);
      expect(h.assertions.isChatErrorVisible('Generation Error')).toBe(false);
    });
  },
);
