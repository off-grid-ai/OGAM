import type { LlamaContext } from 'llama.rn';
import { Platform } from 'react-native';
import logger from '../utils/logger';

export function resolveGpuBackend(enabled: boolean, devices: string[]): string {
  if (!enabled) return 'CPU';
  return Platform.OS === 'ios'
    ? 'Metal'
    : devices.length > 0
    ? devices.join(', ')
    : 'OpenCL';
}

export function deriveToolCallingSupport(context: LlamaContext): boolean {
  try {
    const jinja = (context as any)?.model?.chatTemplates?.jinja;
    logger.log('[LLM][TOOLS] Full jinja caps:', JSON.stringify(jinja));
    logger.log(`[WIRE-CAPS] ${JSON.stringify({ jinja })}`);
    const supported = !!(
      jinja?.defaultCaps?.toolCalls ||
      jinja?.toolUse ||
      jinja?.toolUseCaps?.toolCalls
    );
    logger.log('[LLM][TOOLS] toolCallingSupported =', supported);
    return supported;
  } catch (error) {
    logger.warn('[LLM] Error detecting tool calling support:', error);
    return false;
  }
}
