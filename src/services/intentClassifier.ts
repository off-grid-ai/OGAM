import { classifyToolsNeeded, type GenerationIntent } from '@offgrid/models';
import { generationIntent } from './composition/chat-services';
import { classifyMobileIntent, type ClassifyOptions } from './intentClassifierPorts';

/** Consumer-facing handle on the composed generation-intent service. */
class MobileIntentClassifier {
  classifyIntent(
    message: string,
    options: ClassifyOptions | boolean = true,
  ): Promise<GenerationIntent> {
    const opts = typeof options === 'boolean' ? { useLLM: options } : options;
    return classifyMobileIntent(generationIntent(), message, opts);
  }

  quickCheck(message: string): GenerationIntent {
    return generationIntent().quickCheck(message);
  }

  clearCache(): void {
    generationIntent().clear();
  }
}

export const intentClassifier = new MobileIntentClassifier();
export { classifyToolsNeeded };
