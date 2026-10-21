import logger from '../utils/logger';
import { modelDeclaresMtp } from '../utils/mtpSupport';
import { readModelHeader } from './modelHeader';
import { installedMtpHeadPath } from './mtpHeads';

/**
 * The I/O half of "can this model draft its own tokens": read the GGUF's self-declared metadata and
 * hand it to the pure rule. The header read is cached per path (modelHeader), which is what lets
 * the chat suggest MTP without the user hunting through settings.
 */
export async function modelSupportsMtp(modelPath: string | undefined): Promise<boolean> {
  if (!modelPath) return false;
  const supports = modelDeclaresMtp(await readModelHeader(modelPath));
  logger.log(`[MTP-SM] ${modelPath.split('/').pop()} declares MTP=${supports}`);
  return supports;
}

/**
 * Whether this load may actually enable MTP: the user asked for it AND the model declares draft
 * layers. Passing speculative decoding to a model without them is not the harmless no-op llama.rn's
 * docs imply — on iOS it left the context wedged, every completion failing with "Exception in host
 * function. Context is busy" (device-confirmed). The setting states a preference; this is the one
 * place that decides whether the engine can honour it.
 */
export async function resolveSpeculative(modelPath: string, requested: boolean | undefined): Promise<boolean> {
  if (!requested) return false;
  // A downloaded MTP head brings its own draft layers, so the model needs none of its own.
  const supported = (await installedMtpHeadPath(modelPath)) !== undefined || await modelSupportsMtp(modelPath);
  if (!supported) logger.log('[MTP-SM] speculative requested but this model has no draft layers or head — not enabling');
  return supported;
}
