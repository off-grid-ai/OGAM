import type { TextEngineApplicationService } from '@offgrid/models';
import logger from '../../utils/logger';
import { liteRTService } from '../litert';
import { llmService } from '../llm';
import { nativeReleaseToResidentReclaim } from '../nativeRelease';
import { activeMobileRoute } from './mobileLLMService';

/**
 * Native text-runtime ports. Shared owns route, capability, and lifecycle policy.
 *
 * On `unload`, the engine wrappers return native release proof. This adapter converts that proof
 * through the same mapping as every residency port. A refusal stays a refusal; it is never reduced
 * to the absence of a thrown error.
 *
 * The residency path for these same engines is `modelLifecyclePorts`, where the answer IS mapped to
 * `ResidentReclaim` and does gate admission. What is still lost is inside shared's `unloadAll`,
 * which drops a returned refusal - WIRING_B #14.
 */
export function mobileTextEnginePorts(): ConstructorParameters<typeof TextEngineApplicationService>[0] {
  return {
  active: () => activeMobileRoute('text'),
  engines: [
    {
      id: 'litert',
      isAvailable: () => liteRTService.isAvailable(),
      isLoaded: () => liteRTService.isModelLoaded(),
      unload: async () =>
        nativeReleaseToResidentReclaim(await liteRTService.unloadModel()),
      stop: () => liteRTService.stopGeneration(),
      invalidateConversation: () => liteRTService.invalidateConversation(),
      // Every supported Mobile LiteRT bundle is a curated Gemma 4 bundle.
      requiresLeadingThinkToken: () => true,
    },
    {
      id: 'llama',
      isAvailable: () => true,
      isLoaded: () => llmService.isModelLoaded(),
      unload: async () =>
        nativeReleaseToResidentReclaim(await llmService.unloadModel()),
      stop: () => llmService.stopGeneration(),
      prepareConversation: id => llmService.prepareConversationBoundary(id),
      invalidateConversation: () => llmService.clearKVCache(true),
      backendFallbackNotice: () => llmService.getBackendFallbackNotice(),
      requiresLeadingThinkToken: () => llmService.getReasoningMetadata()?.reasoningFormat === 'auto',
    },
  ],
  onBoundaryError(operation, engineId, error) {
    logger.warn(`[TextEngine] ${operation} failed for ${engineId}:`, error);
  },
  };
}
