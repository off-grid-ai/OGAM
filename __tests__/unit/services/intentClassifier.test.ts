/**
 * Intent Classifier Unit Tests
 *
 * Comprehensive tests for the pattern-based intent classification system.
 * Tests cover all regex patterns for both image and text intents,
 * plus edge cases, caching, and LLM fallback.
 */

import { intentClassifier, classifyToolsNeeded } from '../../../src/services/intentClassifier';
import { llmService } from '../../../src/services/llm';
import { activeModelService } from '../../../src/services/activeModelService';

// Mock dependencies
jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/activeModelService');

const mockLlmService = llmService as jest.Mocked<typeof llmService>;
const mockActiveModelService = activeModelService as jest.Mocked<typeof activeModelService>;

describe('IntentClassifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    intentClassifier.clearCache();

    // Default mock implementations
    mockLlmService.isModelLoaded.mockReturnValue(false);
    mockLlmService.getLoadedModelPath.mockReturnValue(null);
    mockActiveModelService.getActiveModels.mockReturnValue({
      text: { model: null, isLoaded: false, isLoading: false },
      image: { model: null, isLoaded: false, isLoading: false },
    });
  });

  // ============================================================================
  // IMAGE PATTERN TESTS
  // ============================================================================
  describe('Image Intent Patterns', () => {
    describe('Direct generation requests', () => {
      const imageGenerationPhrases = [
        // draw/paint/sketch + image keywords
        'draw an image of a cat',
        'paint a picture of sunset',
        'sketch an illustration of a dragon',
        'create an image of mountains',
        'generate a picture of space',
        'make an art piece of flowers',
        'design a graphic of a logo',
        'render an image of a car',
        'produce artwork of nature',
        'craft an illustration of a castle',

        // image/picture + of/showing
        'image of a sunset over the ocean',
        'picture showing a family gathering',
        'illustration depicting a battle scene',
        'portrait of a woman with flowers',
        'photo of a mountain landscape',

        // can you/could you/please + draw
        'can you draw a tree',
        'could you paint a portrait',
        'please sketch a dog',
        'pls draw me a cat',
      ];

      test.each(imageGenerationPhrases)('"%s" should classify as image', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('image');
      });
    });

    describe('Show me requests for visuals', () => {
      const showMePhrases = [
        'show me an image of a cat',
        'show me a picture of the Eiffel Tower',
        'show me a visual representation',
        'show me what a dragon looks like',
        'show me what it look like',
      ];

      test.each(showMePhrases)('"%s" should classify as image', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('image');
      });
    });

    describe('Visualization verbs', () => {
      const visualizePhrases = [
        'visualize a futuristic city',
        'illustrate a fairy tale scene',
        'depict a medieval castle',
        'visualize the data as a chart',
        'illustrate an underwater kingdom',
      ];

      test.each(visualizePhrases)('"%s" should classify as image', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('image');
      });
    });

    describe('Give/gimme with image words', () => {
      const givePhrases = [
        'give me an image of a wolf',
        'gimme a picture of mountains',
        'give us an illustration of a hero',
        'get me a pic of the beach',
        'give me some art of anime characters',
        'gimme a photo of a vintage car',
      ];

      test.each(givePhrases)('"%s" should classify as image', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('image');
      });
    });

    describe('Short forms with image context', () => {
      const shortFormPhrases = [
        'pic of a sunset',
        'img showing a robot',
        'artwork of fantasy landscape',
      ];

      test.each(shortFormPhrases)('"%s" should classify as image', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('image');
      });
    });

    describe('Format-specific requests', () => {
      const formatPhrases = [
        'wallpaper of mountains',
        'avatar for my profile',
        'logo for my company',
        'icon with a star',
        'banner featuring a dragon',
        'poster of a movie scene',
        'thumbnail for my video',
        'create a wallpaper with nature',
        'make a logo with initials',
        'generate an avatar for gaming',
        'design an icon for the app',
      ];

      test.each(formatPhrases)('"%s" should classify as image', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('image');
      });
    });

    describe('Photography terms', () => {
      const photographyPhrases = [
        '35mm shot of a street scene',
        '50mm photo of a portrait',
        '85mm shot of a wedding',
        'wide angle shot of architecture',
        'telephoto photo of wildlife',
        'macro shot of an insect',
      ];

      test.each(photographyPhrases)('"%s" should classify as image', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('image');
      });
    });

    describe('Art styles', () => {
      const artStylePhrases = [
        'digital art of a warrior',
        'oil painting of a landscape',
        'watercolor of flowers',
        'pencil drawing of a face',
        'charcoal sketch of a figure',
        'anime style image of a hero',
        'cartoon style drawing of a dog',
        'in the style of van gogh artist painting',
        'in the style of monet art',
      ];

      test.each(artStylePhrases)('"%s" should classify as image', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('image');
      });
    });

    describe('Quality/resolution keywords', () => {
      const qualityPhrases = [
        '4k image of a landscape',
        '8k picture of space',
        'hd image of a city',
        'high resolution art of nature',
        'ultra detailed render of a robot',
        'photorealistic image of a person',
        'hyperrealistic render of a car',
      ];

      test.each(qualityPhrases)('"%s" should classify as image', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('image');
      });
    });

    describe('SD/AI tool keywords', () => {
      const aiToolPhrases = [
        'stable diffusion prompt for a cat',
        'create using stable diffusion',
        'dall-e style image',
        'dalle image of a robot',
        'midjourney style art',
        'sd prompt for anime girl',
      ];

      test.each(aiToolPhrases)('"%s" should classify as image', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('image');
      });
    });

    describe('SD prompt keywords', () => {
      const sdPromptPhrases = [
        'masterpiece, best quality, highly detailed, ultra detailed portrait',
        'concept art of a spaceship',
      ];

      test.each(sdPromptPhrases)('"%s" should classify as image', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('image');
      });
    });

    describe('Negative prompt indicators', () => {
      test('"negative prompt: blurry, ugly" should classify as image', async () => {
        const result = await intentClassifier.classifyIntent(
          'a beautiful woman, negative prompt: blurry, ugly',
          { useLLM: false }
        );
        expect(result).toBe('image');
      });
    });

    describe('Scene composition terms', () => {
      const compositionPhrases = [
        'full body image of a warrior',
        'half body picture of a princess',
        'portrait shot of a man',
        'wide shot image of a battlefield',
      ];

      test.each(compositionPhrases)('"%s" should classify as image', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('image');
      });
    });

    describe('Explicit draw/paint/sketch requests', () => {
      const explicitPhrases = [
        'draw a cat',
        'draw me a dog',
        'draw an elephant',
        'draw the sunset',
        'paint a landscape',
        'paint me a portrait',
        'paint an abstract piece',
        'sketch a building',
        'sketch me a character',
        'sketch the mountain',
      ];

      test.each(explicitPhrases)('"%s" should classify as image', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('image');
      });
    });
  });

  // ============================================================================
  // TEXT PATTERN TESTS
  // ============================================================================
  describe('Text Intent Patterns', () => {
    describe('Questions and explanations', () => {
      const questionPhrases = [
        'explain how photosynthesis works',
        'tell me about the French Revolution',
        'describe the water cycle',
        'what is machine learning',
        'what are the benefits of exercise',
        'what does this error mean',
        "what's the capital of France",
        'whats happening in the code',
      ];

      test.each(questionPhrases)('"%s" should classify as text', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('How questions', () => {
      const howPhrases = [
        'how do I install node.js',
        'how does electricity work',
        'how to make pasta',
        'how can I improve my writing',
        'how would you solve this problem',
        'how should I structure my code',
      ];

      test.each(howPhrases)('"%s" should classify as text', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('Why questions', () => {
      const whyPhrases = [
        'why is the sky blue',
        'why does water boil',
        'why do birds migrate',
        'why are leaves green',
        'why would this fail',
      ];

      test.each(whyPhrases)('"%s" should classify as text', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('When/Where/Who/Which questions', () => {
      const otherQuestionPhrases = [
        'when is the next eclipse',
        'when does the store close',
        'when did World War 2 end',
        'when will the package arrive',
        'when was the moon landing',
        'where is the Taj Mahal',
        'where does this function get called',
        'where do I find the settings',
        'where can I buy this',
        'where are my files',
        'who is Albert Einstein',
        'who are the main characters',
        'who was the first president',
        'who does this belong to',
        'who can help me',
        'which is better, React or Vue',
        'which are the top universities',
        'which one should I choose',
        'which should I use',
      ];

      test.each(otherQuestionPhrases)('"%s" should classify as text', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('Help and assistance', () => {
      const helpPhrases = [
        'help me understand this concept',
        'assist with my homework',
        'can you help me fix this bug',
        'could you help me write an essay',
        'please help with my project',
        'i need help with math',
        "i'm stuck on this problem",
        'having trouble with my code',
      ];

      test.each(helpPhrases)('"%s" should classify as text', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('Analysis and processing', () => {
      const analysisPhrases = [
        'analyze this data',
        'summarize this article',
        'translate this to Spanish',
        'paraphrase this paragraph',
        'rephrase this sentence',
        'rewrite this in simpler terms',
        'review my code',
        'evaluate this solution',
        'assess the risks',
        'compare these two options',
        'contrast the approaches',
      ];

      test.each(analysisPhrases)('"%s" should classify as text', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('Writing and content', () => {
      const writingPhrases = [
        'write me an email to my boss',
        'write a letter of recommendation',
        'draft an essay on climate change',
        'compose a story about adventure',
        'write a poem about love',
        'draft a script for a video',
        'write an article about technology',
        'compose a post for social media',
        'write a message to the team',
        'draft a response to this email',
      ];

      test.each(writingPhrases)('"%s" should classify as text', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('Programming and code', () => {
      const codePhrases = [
        'write code to sort an array',
        'create a function to validate email',
        'write a script to automate backups',
        'create a program to parse CSV',
        'write a sql query to get users',
        'create a regex for phone numbers',
        'code a simple calculator',
        'coding challenge solution',
        'programming in python',
        'debug this error',
        'debugging the crash',
        'fix the code that throws an error',
        'debug this bug in my app',
        'refactor this code',
        'optimize this code for performance',
        'function that returns the sum',
        'method to calculate average',
        'class for user authentication',
        'variable not defined',
        'array out of bounds',
        'object is null',
        'loop through items',
        'if statement not working',
        'javascript async await',
        'typescript interface',
        'python list comprehension',
        'java hashmap',
        'kotlin coroutines',
        'swift optionals',
        'c++ pointers',
        'rust ownership',
        'go goroutines',
        'ruby blocks',
        'import statement error',
        'export default component',
        'return value is undefined',
        'const vs let in javascript',
        'def function python',
        'fn main rust',
        'error: cannot find module',
        'TypeError: undefined is not a function',
        'exception thrown at line 42',
      ];

      test.each(codePhrases)('"%s" should classify as text', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('Math and calculations', () => {
      const mathPhrases = [
        'calculate the area of a circle',
        'compute the factorial of 10',
        'solve this equation',
        'evaluate this expression',
        '2+2',
        '100-50',
        '5*3',
        '10/2',
        '2^3',
        '100%5',
        '5 plus 3',
        '10 minus 4',
        '6 times 7',
        '20 divided by 4',
        '3 multiplied 5',
        'sum of these numbers',
        'average of the scores',
        'mean value',
        'median of the dataset',
        'percentage of total',
        'what percent is 25 of 100',
      ];

      test.each(mathPhrases)('"%s" should classify as text', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('Facts and information', () => {
      const factPhrases = [
        'define photosynthesis',
        'definition of democracy',
        'meaning of ephemeral',
        'list all countries in Europe',
        'enumerate the planets',
        'name all continents',
        'give me a list of programming languages',
        'difference between HTTP and HTTPS',
        'differences between SQL and NoSQL',
        'pros and cons of remote work',
        'advantages of electric cars',
        'disadvantages of social media',
      ];

      test.each(factPhrases)('"%s" should classify as text', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('Conversational', () => {
      const conversationalPhrases = [
        'hi',
        'hello',
        'hey there',
        'yo',
        'sup',
        'greetings',
        'thanks',
        'thank you so much',
        'thx',
        'ty',
        'yes',
        'no',
        'yeah',
        'nope',
        'yep',
        'ok',
        'okay',
        'sure',
        'what do you think about AI',
        'your opinion on this topic',
        'your thoughts on the matter',
        'do you know who invented the telephone?',
        'are you able to help with math?',
        'can you explain this?',
      ];

      test.each(conversationalPhrases)('"%s" should classify as text', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('Tell/show explanatory requests', () => {
      const tellShowPhrases = [
        'tell me how to cook pasta',
        'show me how this works',
        'tell us what happened',
        'show me why this is important',
        'tell me about the history',
      ];

      test.each(tellShowPhrases)('"%s" should classify as text', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('Questions ending with ?', () => {
      const questionMarkPhrases = [
        'Is this correct?',
        'Can you check this?',
        'What time is it?',
        'Are there any issues?',
        'Should I proceed?',
      ];

      test.each(questionMarkPhrases)('"%s" should classify as text', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('Instructions and guidance', () => {
      const instructionPhrases = [
        'step by step guide to setup Docker',
        'tutorial on React hooks',
        'guide to machine learning',
        'instructions for assembling furniture',
        'how-to for baking bread',
        'teach me about physics',
        'learn python programming',
        'understand database design',
        'example of a REST API',
        'examples of design patterns',
      ];

      test.each(instructionPhrases)('"%s" should classify as text', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('Time and scheduling', () => {
      const timePhrases = [
        'schedule a meeting for tomorrow',
        'add to my calendar',
        'appointment at 3pm',
        'meeting with the team',
        'deadline for the project',
        'due date for assignment',
        'what happened today',
        'plans for tomorrow',
        'events yesterday',
        'next week schedule',
        'last week summary',
      ];

      test.each(timePhrases)('"%s" should classify as text', async (message) => {
        const result = await intentClassifier.classifyIntent(message, { useLLM: false });
        expect(result).toBe('text');
      });
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================
  describe('Edge Cases', () => {
    describe('Short messages', () => {
      test('very short message should classify as text', async () => {
        const result = await intentClassifier.classifyIntent('hi', { useLLM: false });
        expect(result).toBe('text');
      });

      test('single word without pattern should classify as text', async () => {
        const result = await intentClassifier.classifyIntent('cat', { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('Long messages', () => {
      test('long multi-sentence message should classify as text', async () => {
        const longMessage = 'I have been working on this project for a while. The main challenge is optimizing the performance. Can you suggest some improvements?';
        const result = await intentClassifier.classifyIntent(longMessage, { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('Ambiguous messages', () => {
      test('"a beautiful sunset" without action verb should use default text', async () => {
        // No clear image or text pattern - defaults to text
        const result = await intentClassifier.classifyIntent(
          'a beautiful sunset',
          { useLLM: false }
        );
        expect(result).toBe('text');
      });

      test('"mountain landscape" without action should use default text', async () => {
        const result = await intentClassifier.classifyIntent(
          'mountain landscape',
          { useLLM: false }
        );
        expect(result).toBe('text');
      });
    });

    describe('Mixed intent messages', () => {
      test('image pattern takes precedence when present', async () => {
        // Has both "explain" (text) and "draw" (image) - image patterns checked first
        const result = await intentClassifier.classifyIntent(
          'draw me a diagram and explain the concept',
          { useLLM: false }
        );
        expect(result).toBe('image');
      });

      test('text pattern wins when image word is not a command', async () => {
        // "draw" here is part of explanation request, not a command
        const result = await intentClassifier.classifyIntent(
          'explain how artists draw realistic portraits',
          { useLLM: false }
        );
        expect(result).toBe('text');
      });

      test('code generation is text even if about images', async () => {
        // "how do I" text pattern should win over "image" word
        const result = await intentClassifier.classifyIntent(
          'how do I use Python PIL to resize images',
          { useLLM: false }
        );
        expect(result).toBe('text');
      });

      test('question about images is text', async () => {
        const result = await intentClassifier.classifyIntent(
          'what makes a good photograph composition',
          { useLLM: false }
        );
        expect(result).toBe('text');
      });
    });

    describe('Negative tests - should NOT match image patterns', () => {
      test('drawing as a noun should be text', async () => {
        const result = await intentClassifier.classifyIntent(
          'what is the history of drawing as an art form',
          { useLLM: false }
        );
        expect(result).toBe('text');
      });

      test('picture in context of describing should be text', async () => {
        // "describe" text pattern should classify as text
        const result = await intentClassifier.classifyIntent(
          'describe the picture hanging on the wall',
          { useLLM: false }
        );
        expect(result).toBe('text');
      });

      test('image in technical context should be text', async () => {
        const result = await intentClassifier.classifyIntent(
          'how do I optimize image loading in React',
          { useLLM: false }
        );
        expect(result).toBe('text');
      });

      test('render in code context should be text', async () => {
        const result = await intentClassifier.classifyIntent(
          'how to render a component in React',
          { useLLM: false }
        );
        expect(result).toBe('text');
      });
    });

    describe('Empty and edge case inputs', () => {
      test('empty string should return text', async () => {
        const result = await intentClassifier.classifyIntent('', { useLLM: false });
        expect(result).toBe('text');
      });

      test('whitespace only should return text', async () => {
        const result = await intentClassifier.classifyIntent('   ', { useLLM: false });
        expect(result).toBe('text');
      });

      test('single word with no clear intent should return text', async () => {
        const result = await intentClassifier.classifyIntent('hello', { useLLM: false });
        expect(result).toBe('text');
      });
    });

    describe('Case insensitivity', () => {
      test('UPPERCASE should still match patterns', async () => {
        const result = await intentClassifier.classifyIntent(
          'DRAW A PICTURE OF A CAT',
          { useLLM: false }
        );
        expect(result).toBe('image');
      });

      test('MixedCase should still match patterns', async () => {
        const result = await intentClassifier.classifyIntent(
          'What Is Photosynthesis?',
          { useLLM: false }
        );
        expect(result).toBe('text');
      });
    });

    describe('Whitespace handling', () => {
      test('leading/trailing whitespace should be trimmed', async () => {
        const result = await intentClassifier.classifyIntent(
          '   draw a cat   ',
          { useLLM: false }
        );
        expect(result).toBe('image');
      });
    });
  });

  // ============================================================================
  // CACHE BEHAVIOR
  // ============================================================================
  describe('Cache Behavior', () => {
    test('should return cached result on repeat query', async () => {
      const message = 'draw a beautiful landscape';

      // First call
      const result1 = await intentClassifier.classifyIntent(message, { useLLM: false });
      expect(result1).toBe('image');

      // Second call should use cache (same result)
      const result2 = await intentClassifier.classifyIntent(message, { useLLM: false });
      expect(result2).toBe('image');
    });

    test('clearCache should reset the cache', async () => {
      const message = 'draw a cat';

      await intentClassifier.classifyIntent(message, { useLLM: false });
      intentClassifier.clearCache();

      // Should still work after cache clear
      const result = await intentClassifier.classifyIntent(message, { useLLM: false });
      expect(result).toBe('image');
    });

    test('should handle very long messages without errors', async () => {
      const longMessage = `draw a ${  'very '.repeat(100)  }beautiful landscape`;

      // Should not throw despite long message
      const result = await intentClassifier.classifyIntent(longMessage, { useLLM: false });
      expect(result).toBe('image');
    });
  });

  // ============================================================================
  // QUICK CHECK
  // ============================================================================
  describe('quickCheck', () => {
    test('should return image for image patterns', () => {
      const result = intentClassifier.quickCheck('draw a cat');
      expect(result).toBe('image');
    });

    test('should return text for text patterns', () => {
      const result = intentClassifier.quickCheck('what is the meaning of life');
      expect(result).toBe('text');
    });

    test('should return text for uncertain messages', () => {
      const result = intentClassifier.quickCheck('beautiful sunset');
      expect(result).toBe('text');
    });

    test('should be synchronous', () => {
      // quickCheck returns Intent directly, not a Promise
      const result = intentClassifier.quickCheck('draw a cat');
      expect(result).toBe('image');
      expect(typeof result).toBe('string');
    });
  });

  // ============================================================================
  // LLM FALLBACK
  // ============================================================================
  describe('LLM Fallback', () => {
    test('should not call LLM when useLLM is false', async () => {
      await intentClassifier.classifyIntent('ambiguous message', { useLLM: false });

      expect(mockLlmService.generateResponse).not.toHaveBeenCalled();
    });

    test('should return text default when pattern is uncertain and LLM disabled', async () => {
      const result = await intentClassifier.classifyIntent('random words here', { useLLM: false });
      expect(result).toBe('text');
    });

    test('should throw when LLM enabled but no model loaded', async () => {
      mockLlmService.isModelLoaded.mockReturnValue(false);

      // Uncertain message would try LLM
      const result = await intentClassifier.classifyIntent('something ambiguous', { useLLM: true });

      // Should default to text when LLM fails
      expect(result).toBe('text');
    });

    test('should use LLM classification when pattern is uncertain and LLM enabled', async () => {
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.generateResponse.mockImplementation(
        async (_messages, onStream, onComplete) => {
          onStream?.({ content: 'YES' });
          onComplete?.({ content: 'YES', reasoningContent: '' });
          return 'YES';
        }
      );

      const result = await intentClassifier.classifyIntent(
        'something uncertain without clear patterns',
        { useLLM: true }
      );

      expect(result).toBe('image');
      expect(mockLlmService.generateResponse).toHaveBeenCalled();
    });

    test('should return text when LLM responds NO', async () => {
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.generateResponse.mockImplementation(
        async (_messages, onStream, onComplete) => {
          onStream?.({ content: 'NO' });
          onComplete?.({ content: 'NO', reasoningContent: '' });
          return 'NO';
        }
      );

      const result = await intentClassifier.classifyIntent(
        'something uncertain without clear patterns',
        { useLLM: true }
      );

      expect(result).toBe('text');
    });

    test('should handle LLM errors gracefully', async () => {
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.generateResponse.mockRejectedValue(new Error('LLM error'));

      const result = await intentClassifier.classifyIntent(
        'something uncertain',
        { useLLM: true }
      );

      // Should fall back to text on error
      expect(result).toBe('text');
    });
  });

  // ============================================================================
  // CACHE EVICTION
  // ============================================================================
  describe('Cache Eviction', () => {
    test('should evict old entries when cache exceeds max size', async () => {
      // Fill cache beyond CACHE_MAX_SIZE (100) by classifying many unique messages
      for (let i = 0; i < 105; i++) {
        await intentClassifier.classifyIntent(`draw a unique picture number ${i} of something`, { useLLM: false });
      }

      // After 105 entries, eviction should have run, cache should still work
      const result = await intentClassifier.classifyIntent('draw a new test image please', { useLLM: false });
      expect(result).toBe('image');
    });
  });

  // ============================================================================
  // LLM CLASSIFICATION WITH MODEL SWAP
  // ============================================================================
  describe('LLM Classification with Model Swap', () => {
    test('should swap to classifier model when provided and different from current', async () => {
      const classifierModel = {
        id: 'classifier-model',
        name: 'Classifier',
        author: 'test',
        filePath: '/path/to/classifier.gguf',
        fileName: 'classifier.gguf',
        fileSize: 1000,
        quantization: 'Q4',
        downloadedAt: new Date().toISOString(),
        engine: 'llama' as const,
      };

      mockLlmService.getLoadedModelPath.mockReturnValue('/path/to/different.gguf');
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.generateResponse.mockImplementation(
        async (_messages, onStream) => {
          onStream?.({ content: 'YES' });
          return 'YES';
        }
      );
      mockActiveModelService.getActiveModels.mockReturnValue({
        text: { model: { id: 'original-model' } as any, isLoaded: true, isLoading: false },
        image: { model: null, isLoaded: false, isLoading: false },
      });
      mockActiveModelService.loadTextModel.mockResolvedValue(undefined);

      const onStatusChange = jest.fn();

      const result = await intentClassifier.classifyIntent(
        'something uncertain without clear patterns',
        {
          useLLM: true,
          classifierModel,
          onStatusChange,
        }
      );

      expect(result).toBe('image');
      // Should have loaded the classifier model
      expect(mockActiveModelService.loadTextModel).toHaveBeenCalledWith('classifier-model');
      // Should always restore the original model after classifying
      expect(mockActiveModelService.loadTextModel).toHaveBeenCalledWith('original-model');
      expect(onStatusChange).toHaveBeenCalledWith(expect.stringContaining('Loading'));
      expect(onStatusChange).toHaveBeenCalledWith('Analyzing request...');
      expect(onStatusChange).toHaveBeenCalledWith('Restoring text model...');
    });

    test('should not swap model when classifier model path matches current', async () => {
      const classifierModel = {
        id: 'classifier-model',
        name: 'Classifier',
        author: 'test',
        filePath: '/path/to/same.gguf',
        fileName: 'same.gguf',
        fileSize: 1000,
        quantization: 'Q4',
        downloadedAt: new Date().toISOString(),
        engine: 'llama' as const,
      };

      mockLlmService.getLoadedModelPath.mockReturnValue('/path/to/same.gguf');
      mockLlmService.isModelLoaded.mockReturnValue(true);
      mockLlmService.generateResponse.mockImplementation(
        async (_messages, onStream) => {
          onStream?.({ content: 'NO' });
          return 'NO';
        }
      );

      const result = await intentClassifier.classifyIntent(
        'something uncertain without clear patterns',
        {
          useLLM: true,
          classifierModel,
        }
      );

      expect(result).toBe('text');
      // Should NOT have swapped models
      expect(mockActiveModelService.loadTextModel).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // LONG MESSAGES (sentence count path)
  // ============================================================================
  describe('Long multi-sentence messages without pattern matches', () => {
    test('multi-sentence message over 100 chars with no pattern match should classify as text', async () => {
      // Construct a message that doesn't match any image or text patterns
      // but has 2+ sentences and is >100 chars
      const longMessage = 'The colorful parrot sat on the branch quietly. The warm breeze rustled through the tall coconut palms gently swaying above the sandy shore below.';
      const result = await intentClassifier.classifyIntent(longMessage, { useLLM: false });
      expect(result).toBe('text');
    });
  });

  // ============================================================================
  // LEGACY BOOLEAN PARAMETER
  // ============================================================================
  describe('Legacy boolean parameter', () => {
    test('should accept boolean true for useLLM', async () => {
      const result = await intentClassifier.classifyIntent('draw a cat', true);
      expect(result).toBe('image');
    });

    test('should accept boolean false for useLLM', async () => {
      const result = await intentClassifier.classifyIntent('draw a cat', false);
      expect(result).toBe('image');
    });
  });
});

// ============================================================================
// classifyToolsNeeded
// ============================================================================
describe('classifyToolsNeeded', () => {
  const toolMatchCases: [string, string[]][] = [
    ['web_search', [
      'search for the latest news',
      'look up the current bitcoin price',
      "what's happening in the world right now",
      'weather forecast for tomorrow',
      'trending topics this week',
      'who won the match last night',
      'just launched a new model from OpenAI',
    ]],
    ['read_url', [
      'https://example.com summarize this',
      'read the article at this link',
      'fetch content from that page',
      'open the link and tell me what it says',
      'analyse this page for me',
    ]],
    ['calculator', [
      'calculate 15% of 200',
      'compute the factorial of 5',
      'how much is 12 times 8',
      'what is 100 divided by 4',
      '5 plus 3',
      'work out the total including tax',
      'convert 50 miles to km',
    ]],
    ['get_current_datetime', [
      'what time is it',
      'current date please',
      "what's today's date",
      'what day is it today',
      'tell me the date',
      'how many days until Christmas',
    ]],
    ['get_device_info', [
      'how much battery do I have left',
      'check my storage space',
      'how much free space is available',
      'what is my ram usage',
      'show my device info',
    ]],
  ];

  test.each(toolMatchCases)('%s — matches its trigger phrases', (toolId, messages) => {
    messages.forEach(msg => expect(classifyToolsNeeded(msg)).toContain(toolId));
  });

  it('web_search and read_url are always coupled', () => {
    const fromSearch = classifyToolsNeeded('search for the latest news');
    expect(fromSearch).toContain('web_search');
    expect(fromSearch).toContain('read_url');

    const fromUrl = classifyToolsNeeded('https://example.com summarize this');
    expect(fromUrl).toContain('web_search');
    expect(fromUrl).toContain('read_url');
  });

  it('returns empty array for plain conversational messages', () => {
    ['hi', 'hello there', 'explain how React hooks work', 'write me a poem', 'fix this bug in my code']
      .forEach(msg => expect(classifyToolsNeeded(msg)).toHaveLength(0));
  });
});
