import type { GenerationMessage } from '@offgrid/models';
import { registerMobileSidecarExecutionPort } from '../../src/services/mobileSidecarGeneration';

export interface SidecarExecutionBoundary {
  text?: (
    messages: GenerationMessage[],
    options: { maxTokens?: number; onText?: (text: string) => void },
  ) => Promise<string>;
  embedding?: (inputs: string[]) => Promise<number[][]>;
  classification?: (input: string, routeId?: string) => Promise<'image' | 'text'>;
}

function unsupported(operation: string): Promise<never> {
  return Promise.reject(new Error(`The test sidecar does not support ${operation}`));
}

/** Install one explicit test composition for the external sidecar execution boundary. */
export function installSidecarExecutionBoundary(
  boundary: SidecarExecutionBoundary,
): () => void {
  return registerMobileSidecarExecutionPort({
    text: boundary.text ?? (() => unsupported('text generation')),
    embedding: boundary.embedding ?? (() => unsupported('embedding generation')),
    classification: boundary.classification ?? (() => unsupported('classification')),
  });
}
