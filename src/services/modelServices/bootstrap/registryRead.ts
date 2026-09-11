/** Preserve the registry identity when a native storage read fails. */
export function readRegistry<T>(
  registry: 'text' | 'image',
  read: () => Promise<T[]>,
): Promise<T[]> {
  return read().catch(cause => {
    throw Object.assign(new Error(`Could not read the ${registry} model registry.`), {
      name: 'ModelLibraryRegistryReadError',
      kind: 'model-library-registry-read' as const,
      registry,
      cause,
    });
  });
}
