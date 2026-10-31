/**
 * The Hugging Face image catalog, faked at the network edge (global fetch).
 *
 * The Image tab lists packs from three kinds of Hugging Face tree listings:
 *   - xororz/sd-mnn and xororz/sd-qnn (Android GPU and NPU zips),
 *   - the apple/coreml-stable-diffusion-* repos (iOS Core ML), top level and nested folders.
 * This fake answers those URLs with Hugging Face-shaped tree JSON and records each URL asked for.
 * It never parses or decides: the real huggingFaceModelBrowser / coreMLModelBrowser turn the trees
 * into models. Any other URL (a search, a model card) answers an empty list.
 */

export interface HfTreeEntry {
  type: 'file' | 'directory';
  path: string;
  size: number;
  lfs?: { oid: string; size: number; pointerSize: number };
}

export interface HfImageCatalog {
  /** Tree of xororz/sd-mnn. */
  mnn?: HfTreeEntry[];
  /** Tree of xororz/sd-qnn. */
  qnn?: HfTreeEntry[];
  /** Core ML trees by "<repo>" or "<repo>/<folder path>". A repo left out answers 404. */
  coreml?: Record<string, HfTreeEntry[]>;
  /** Every tree request answers this HTTP status instead. */
  status?: number;
  /** Every tree request fails at the transport with this error (no response at all). */
  transportError?: unknown;
}

export interface HfImageCatalogServer {
  /** Replace what the server answers from now on. */
  serve(catalog: HfImageCatalog): void;
  /** Every URL fetched, in order. */
  requests: string[];
  /** Put the previous global fetch back. */
  restore(): void;
}

/** One zip file in a Hugging Face tree, stored with Git LFS (as the real repos are). */
export function lfsFile(path: string, sizeBytes: number): HfTreeEntry {
  return { type: 'file', path, size: 134, lfs: { oid: 'sha', size: sizeBytes, pointerSize: 134 } };
}

export function folder(path: string): HfTreeEntry {
  return { type: 'directory', path, size: 0 };
}

const TREE = /^https:\/\/huggingface\.co\/api\/models\/([^/]+\/[^/]+)\/tree\/main(?:\/(.+))?$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function serveHfImageCatalog(initial: HfImageCatalog = {}): HfImageCatalogServer {
  const previous = globalThis.fetch;
  let catalog = initial;
  const requests: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    const tree = TREE.exec(url);
    if (!tree) return json([]);
    if (catalog.transportError !== undefined) throw catalog.transportError;
    if (catalog.status) return json({ error: 'unavailable' }, catalog.status);
    const [, repo, path] = tree;
    if (repo === 'xororz/sd-mnn' && !path) return json(catalog.mnn ?? []);
    if (repo === 'xororz/sd-qnn' && !path) return json(catalog.qnn ?? []);
    const coreml = catalog.coreml?.[path ? `${repo}/${path}` : repo];
    return coreml ? json(coreml) : json({ error: 'Repository not found' }, 404);
  }) as typeof globalThis.fetch;

  return {
    serve: next => {
      catalog = next;
    },
    requests,
    restore: () => {
      globalThis.fetch = previous;
    },
  };
}
