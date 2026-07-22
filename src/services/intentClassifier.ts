import { llmService } from './llm';
import { activeModelService } from './activeModelService';
import { DownloadedModel } from '../types';
import logger from '../utils/logger';

type Intent = 'image' | 'text';

interface ClassifyOptions {
  useLLM: boolean;
  classifierModel?: DownloadedModel | null;
  currentModelPath?: string | null;
  onStatusChange?: (status: string) => void;
}

// Cache for common patterns to avoid repeated LLM calls
const intentCache = new Map<string, Intent>();
const CACHE_MAX_SIZE = 100;

// Patterns that strongly suggest image generation intent
const IMAGE_PATTERNS = [
  // Direct generation requests - explicit image/picture/art keywords
  /\b(draw|paint|sketch|create|generate|make|design|render|produce|craft)\b.*\b(image|picture|art|illustration|portrait|landscape|scene|photo|artwork|graphic|visual)\b/i,
  /\b(image|picture|art|illustration|portrait|photo|graphic)\b.*\b(of|showing|depicting|with|featuring)\b/i,
  /\b(can you|could you|please|pls)\b.*\b(draw|paint|sketch)\b/i,

  // "Show me" requests specifically for visuals
  /\bshow me\b.*\b(image|picture|visual)\b/i,
  /\bshow me what\b.*\blooks? like\b/i,

  // Visualization verbs (but not "describe" which is text)
  /\b(visualize|illustrate|depict)\b.*\b(a|an|the)\b/i,

  // Give/gimme patterns - must include image-related words
  /\b(give|gimme|get)\b.*\b(me|us)\b.*\b(image|picture|pic|photo|art|illustration|drawing)\b/i,

  // Short forms with explicit image context
  /\b(pic|img|artwork)\b\s+(of|showing)\b/i,

  // Format-specific requests (these are almost always for images)
  /\b(wallpaper|avatar|logo|icon|banner|poster|thumbnail)\b.*\b(of|for|with|featuring)\b/i,
  /\b(create|make|generate|design)\b.*\b(wallpaper|avatar|logo|icon|banner|poster|thumbnail)\b/i,

  // Photography terms in generation context
  /\b(35mm|50mm|85mm|wide angle|telephoto|macro)\b.*\b(shot|photo)\b/i,

  // Art styles that strongly imply image generation
  /\b(digital art|oil painting|watercolor|pencil drawing|charcoal sketch)\b/i,
  /\b(anime style|cartoon style)\b.*\b(of|image|picture|drawing)\b/i,
  /\bin the style of\b.*\b(artist|painter|art)\b/i,

  // Quality/resolution keywords with generation context
  /\b(4k|8k|hd|high resolution|ultra detailed)\b.*\b(image|picture|art|render)\b/i,
  /\b(photorealistic|hyperrealistic)\b.*\b(image|render|of)\b/i,

  // SD/AI tools - strong signals
  /\bstable diffusion\b/i,
  /\bdall-?e\b/i,
  /\bmidjourney\b/i,
  /\bsd prompt\b/i,

  // Common SD prompt keywords (strong signals when combined)
  /\b(masterpiece|best quality)\b.*\b(highly detailed|ultra detailed)\b/i,
  /\bconcept art of\b/i,

  // Negative prompt indicators (very strong signal)
  /\bnegative prompt\b/i,

  // Scene composition terms with visual context
  /\b(full body|half body|portrait shot|wide shot)\b.*\b(of|image|picture|drawing)\b/i,

  // Explicit drawing/painting requests.
  // Idiom guard: exclude the figurative "draw a conclusion / the line / a
  // comparison|distinction|parallel|analogy" senses, which are text, not image
  // requests. The negative lookahead sits after the article so "draw a cat"
  // still matches while "draw a conclusion" falls through to the text patterns.
  /\bdraw\s+(me\s+)?(a|an|the)\s+(?!conclusion|conclusions|line|lines|comparison|comparisons|distinction|distinctions|parallel|parallels|analogy|analogies|attention|blank|card|cards|straw)/i,
  /\bpaint\s+(me\s+)?(a|an|the)\b/i,
  /\bsketch\s+(me\s+)?(a|an|the)\b/i,

  // Bare-verb visual requests (article-optional) — colloquial / voice phrasing.
  // "draw dog", "make sunset", "sketch cat", "paint mountains" omit the article
  // that the patterns above require, so without this they fell through to the
  // LLM/text default. We allow an OPTIONAL article (a|an|the|some) followed by a
  // word, so both "draw a dog" and "draw dog" match.
  //
  // Anchored to the START of the message (after an optional polite prefix like
  // "can you"/"please") so the verb reads as a COMMAND. This is deliberate: image
  // patterns are checked before text patterns, so an unanchored \bdraw\b would
  // hijack explanatory text such as "explain how artists draw realistic
  // portraits". A genuine image request leads with the verb; an explanation
  // buries it mid-sentence.
  //
  // Guard: a few of these verbs head common FIGURATIVE idioms that are text, not
  // image requests — "draw a conclusion", "draw the line", "draw a
  // comparison/distinction/parallel/analogy". The negative lookahead after the
  // optional article excludes those specific nouns so the idioms fall through to
  // the text patterns / LLM rather than being forced to 'image'.
  //
  // We deliberately limit this broadening to the strongly-visual verbs
  // draw/paint/sketch/illustrate/render. We do NOT broaden make/create/generate
  // to a bare noun: those legitimately head TEXT requests ("create a function",
  // "generate a list", "make a decision", "make sense", "make dinner"), so a
  // bare-noun rule for them would misroute code/list/idiom requests to image.
  // They remain gated behind the explicit image-keyword patterns above
  // (e.g. "create an image of…", "make a logo with…"). A bare "make sunset" /
  // "generate dog" therefore falls through to null → LLM, which is preferable
  // to forcing 'image'. "paint a picture of <abstract>" used figuratively is
  // likewise left ambiguous.
  /^(?:(?:can|could|would|will)\s+you\s+|please\s+|pls\s+|hey\s+|ok\s+|okay\s+)*(draw|paint|sketch|illustrate|render)\s+(?:me\s+)?(?:(?:a|an|the|some)\s+)?(?!conclusion|conclusions|line|lines|comparison|comparisons|distinction|distinctions|parallel|parallels|analogy|analogies|attention|blank|breath|straw|card|cards|a\b|an\b|the\b|some\b)[a-z]+\b/i,
];

// Patterns that suggest text/chat intent (not image generation)
const TEXT_PATTERNS = [
  // Questions and explanations
  /\b(explain|tell me|describe|what is|what are|what does|what's|whats)\b/i,
  /\b(how do|how does|how to|how can|how would|how should)\b/i,
  /\b(why is|why does|why do|why are|why would)\b/i,
  /\b(when is|when does|when did|when will|when was)\b/i,
  /\b(where is|where does|where do|where can|where are)\b/i,
  /\b(who is|who are|who was|who does|who can)\b/i,
  /\b(which is|which are|which one|which should)\b/i,

  // Help and assistance
  /\b(help me|assist|can you help|could you help|please help)\b/i,
  /\b(i need help|i'm stuck|having trouble)\b/i,

  // Analysis and processing
  /\b(analyze|summarize|translate|paraphrase|rephrase|rewrite)\b/i,
  /\b(review|evaluate|assess|compare|contrast)\b/i,

  // Writing and content (text-based)
  /\b(write me|write a|draft|compose)\b.*\b(email|letter|essay|story|poem|script|article|post|message|response)\b/i,
  /\b(write|create)\b.*\b(code|function|script|program|query|sql|regex)\b/i,

  // Programming and code
  /\b(code|coding|programming|debug|debugging|compile|build)\b/i,
  /\b(function|method|class|variable|array|object|loop|if statement)\b/i,
  /\b(javascript|typescript|python|java|kotlin|swift|c\+\+|rust|go|ruby)\b/i,
  /\b(fix|debug|refactor|optimize)\b.*\b(code|bug|error|issue)\b/i,
  /\b(import|export|return|const|let|var|def|fn)\b/i,
  /\berror:\s/i,
  /\bexception\b/i,

  // Math and calculations
  /\b(calculate|compute|solve|evaluate)\b/i,
  /^\d+\s*[+\-*/^%]/, // Math operations like "2+2"
  /\b\d+\s*(plus|minus|times|divided by|multiplied)\s*\d+\b/i,
  /\b(sum|average|mean|median|percentage|percent)\b/i,

  // Facts and information
  /\b(define|definition|meaning of)\b/i,
  /\b(list|enumerate|name all|give me a list)\b/i,
  /\b(difference between|differences between)\b/i,
  /\b(pros and cons|advantages|disadvantages)\b/i,

  // Conversational
  /^(hi|hello|hey|yo|sup|greetings)\b/i,
  /^(thanks|thank you|thx|ty)\b/i,
  /^(yes|no|yeah|nope|yep|ok|okay|sure)\b/i,
  /\b(what do you think|your opinion|your thoughts)\b/i,
  /\b(do you know|are you able|can you)\b.*\?/i,

  // Explanatory requests with "tell/show/explain"
  /\b(tell|show)\b.*\b(me|us)\b.*\b(how|what|why|about|the)\b/i,

  // Questions ending with ?
  /\?$/,
  /^[?!]/, // Questions starting with ? or !

  // Instructions and guidance
  /\b(step by step|tutorial|guide|instructions|how-to)\b/i,
  /\b(teach me|learn|understand|example|examples)\b/i,

  // Time and scheduling
  /\b(schedule|calendar|appointment|meeting|deadline|due date)\b/i,
  /\b(today|tomorrow|yesterday|next week|last week)\b/i,
];

/**
 * Classify whether a message is asking to generate an image or requesting a text response.
 * Uses pattern matching first for speed, falls back to LLM classification if uncertain.
 */
class IntentClassifier {
  /**
   * Classify the intent of a message
   * @param message The user's message
   * @param options Classification options including LLM settings
   * @returns 'image' if requesting image generation, 'text' otherwise
   */
  async classifyIntent(
    message: string,
    options: ClassifyOptions | boolean = true,
  ): Promise<Intent> {
    // Handle legacy boolean parameter
    const opts: ClassifyOptions =
      typeof options === 'boolean' ? { useLLM: options } : options;

    const trimmedMessage = message.trim().toLowerCase();
    const logMsg = trimmedMessage.slice(0, 60);

    // Check cache first
    const cacheKey = trimmedMessage.slice(0, 200); // Limit key size
    const cachedIntent = intentCache.get(cacheKey);
    if (cachedIntent) {
      logger.log(
        `[ROUTE-SM] classify CACHE intent=${cachedIntent} msg="${logMsg}"`,
      );
      return cachedIntent;
    }

    // Fast pattern matching
    const patternResult = this.classifyByPattern(trimmedMessage);
    if (patternResult !== null) {
      logger.log(
        `[ROUTE-SM] classify PATTERN intent=${patternResult} msg="${logMsg}"`,
      );
      this.cacheIntent(cacheKey, patternResult);
      return patternResult;
    }

    // If no clear pattern and LLM enabled, use it for classification
    if (opts.useLLM) {
      try {
        const llmResult = await this.classifyWithLLM(message, opts);
        logger.log(
          `[ROUTE-SM] classify LLM intent=${llmResult} msg="${logMsg}"`,
        );
        this.cacheIntent(cacheKey, llmResult);
        return llmResult;
      } catch (error) {
        logger.warn('[IntentClassifier] LLM classification failed:', error);
      }
    }

    // Default to text intent if uncertain
    logger.log(
      `[ROUTE-SM] classify DEFAULT→text (uncertain, llm=${opts.useLLM}) msg="${logMsg}"`,
    );
    return 'text';
  }

  /**
   * Fast pattern-based classification
   * Returns null if uncertain
   */
  private classifyByPattern(message: string): Intent | null {
    // Check for strong image generation indicators
    for (const pattern of IMAGE_PATTERNS) {
      if (pattern.test(message)) {
        logger.log(
          `[ROUTE-SM] classify pattern=IMAGE matched /${pattern.source}/`,
        );
        return 'image';
      }
    }

    // Check for strong text/chat indicators
    for (const pattern of TEXT_PATTERNS) {
      if (pattern.test(message)) {
        logger.log(
          `[ROUTE-SM] classify pattern=TEXT matched /${pattern.source}/`,
        );
        return 'text';
      }
    }

    // Very short messages are likely text queries or simple prompts
    if (message.length < 10) {
      logger.log('[ROUTE-SM] classify pattern=TEXT (message < 10 chars)');
      return 'text';
    }

    // Very long messages with multiple sentences are likely text
    const sentenceCount = (message.match(/[.!?]+/g) || []).length;
    if (sentenceCount >= 2 && message.length > 100) {
      logger.log(
        '[ROUTE-SM] classify pattern=TEXT (multi-sentence long message)',
      );
      return 'text';
    }

    // Uncertain - return null to trigger LLM classification
    return null;
  }

  /**
   * Use LLM for classification when pattern matching is uncertain
   */
  private async classifyWithLLM(
    message: string,
    opts: ClassifyOptions,
  ): Promise<Intent> {
    const classificationPrompt = `Is this message asking to create, generate, or draw an image? Reply only YES or NO.

Message: "${message.slice(0, 200)}"

Answer:`;

    let originalModelId: string | null = null;
    let needsModelSwap = false;

    // Check if we need to swap models
    if (opts.classifierModel && opts.classifierModel.id) {
      const currentPath = llmService.getLoadedModelPath();
      if (currentPath !== opts.classifierModel.filePath) {
        needsModelSwap = true;
        // Store original model ID from the store (not path)
        const activeInfo = activeModelService.getActiveModels();
        originalModelId = activeInfo.text.model?.id || null;

        logger.log(
          '[IntentClassifier] Swapping to classifier model:',
          opts.classifierModel.name,
        );
        opts.onStatusChange?.(`Loading ${opts.classifierModel.name}...`);
        // Use activeModelService singleton to load - prevents duplicate loads
        await activeModelService.loadTextModel(opts.classifierModel.id);
      }
    }

    opts.onStatusChange?.('Analyzing request...');

    // Ensure a model is loaded
    if (!llmService.isModelLoaded()) {
      throw new Error('No model loaded for classification');
    }

    let response = '';

    try {
      // Use a minimal completion with low token limit for speed
      await llmService.generateResponse(
        [
          {
            id: 'classify',
            role: 'user',
            content: classificationPrompt,
            timestamp: Date.now(),
          },
        ],
        {
          onStream: data => {
            if (data.content) response += data.content;
          },
        },
      );
    } finally {
      // Swap back to original model if we changed it
      // Restore the original text model after classifying. The residency
      // manager handles fitting it back into memory (evicting as needed).
      if (needsModelSwap && originalModelId) {
        opts.onStatusChange?.('Restoring text model...');
        await activeModelService.loadTextModel(originalModelId);
      }
    }

    // Parse response
    const normalizedResponse = response.trim().toLowerCase();

    if (normalizedResponse.includes('yes')) {
      return 'image';
    }

    return 'text';
  }

  /**
   * Cache an intent classification
   */
  private cacheIntent(key: string, intent: Intent): void {
    // Prevent cache from growing too large
    if (intentCache.size >= CACHE_MAX_SIZE) {
      // Remove oldest entries (first 20%)
      const keysToRemove = Array.from(intentCache.keys()).slice(
        0,
        Math.floor(CACHE_MAX_SIZE * 0.2),
      );
      keysToRemove.forEach(k => intentCache.delete(k));
    }
    intentCache.set(key, intent);
  }

  /**
   * Clear the intent cache
   */
  clearCache(): void {
    intentCache.clear();
  }

  /**
   * Quick check if message is likely an image request (without LLM)
   * Useful for UI hints before sending
   */
  quickCheck(message: string): Intent {
    const trimmedMessage = message.trim().toLowerCase();
    const patternResult = this.classifyByPattern(trimmedMessage);
    return patternResult ?? 'text';
  }
}

export const intentClassifier = new IntentClassifier();
