import type { GenerationProfileKind } from '@offgrid/models';
import type { GenerationMessage } from '@offgrid/models';
type SidecarExecutionPort = {
  text(messages: GenerationMessage[], options: { profile?: GenerationProfileKind; maxTokens?: number; onText?: (text: string) => void }): Promise<string>;
  embedding(inputs: string[]): Promise<number[][]>;
  classification(input: string, routeId?: string): Promise<'image' | 'text'>;
};

let port: SidecarExecutionPort | null = null;

/** Composition-root seam. Domain callers depend on this narrow port, not the model-service barrel. */
export function registerMobileSidecarExecutionPort(next: SidecarExecutionPort): () => void {
  port = next;
  return () => { if (port === next) port = null; };
}

function executionPort(): SidecarExecutionPort {
  if (!port) throw new Error('Mobile sidecar execution is not registered');
  return port;
}

export async function executeMobileText(
  messages: GenerationMessage[],
  options: { profile?: GenerationProfileKind; maxTokens?: number; onText?: (text: string) => void } = {},
): Promise<string> {
  return executionPort().text(messages, options);
}

export async function executeMobileEmbedding(inputs: string[]): Promise<number[][]> {
  return executionPort().embedding(inputs);
}

export async function executeMobileClassification(
  input: string,
  routeId?: string,
): Promise<'image' | 'text'> {
  return executionPort().classification(input, routeId);
}
