/**
 * The Hugging Face model API, faked at the network edge (global fetch), for the text-model paths:
 * the model search, a repo's file listing with sizes (`?blobs=true`), and a repo's file tree at a
 * revision. It answers in Hugging Face's own JSON shapes and records each URL asked for. It never
 * decides: the real huggingFaceService turns the answers into candidates, files and projectors.
 *
 * A repo that is not served answers 401, as Hugging Face answers an unknown repo. A search answers
 * the served repos whose id contains the query (case-insensitive).
 */

export interface HfRepoFile {
  path: string;
  size: number;
}

export interface HfModelApi {
  /** Repos by id, each with its files at every revision. */
  repos?: Record<string, HfRepoFile[]>;
  /** Every request answers this HTTP status instead. */
  status?: number;
}

export interface HfModelApiServer {
  serve(api: HfModelApi): void;
  requests: string[];
  restore(): void;
}

const API = 'https://huggingface.co/api/models';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function serveHfModelApi(initial: HfModelApi = {}): HfModelApiServer {
  const previous = globalThis.fetch;
  let api = initial;
  const requests: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    if (!url.startsWith(API)) return json({ error: 'not found' }, 404);
    if (api.status) return json({ error: 'unavailable' }, api.status);
    const repos = api.repos ?? {};
    const parsed = new URL(url);
    const rest = decodeURIComponent(parsed.pathname.replace(/^\/api\/models\/?/, ''));

    if (rest === '') {
      const query = (parsed.searchParams.get('search') ?? '').toLowerCase();
      const ids = Object.keys(repos).filter(id => id.toLowerCase().includes(query));
      return json(ids.map(id => ({ id, modelId: id, author: id.split('/')[0], downloads: 1, likes: 0, tags: ['gguf'] })));
    }

    const tree = /^([^/]+\/[^/]+)\/tree\/[^/]+$/.exec(rest);
    const repoId = tree ? tree[1] : /^([^/]+\/[^/]+)/.exec(rest)?.[1];
    const files = repoId ? repos[repoId] : undefined;
    if (!files) return json({ error: 'Repository not found' }, 401);
    if (tree) {
      return json(files.map(f => ({ type: 'file', path: f.path, size: 134, lfs: { oid: 'sha', size: f.size, pointerSize: 134 } })));
    }
    return json({
      id: repoId,
      author: repoId!.split('/')[0],
      siblings: files.map(f => ({ rfilename: f.path, size: f.size, lfs: { size: f.size } })),
    });
  }) as typeof fetch;

  return {
    serve: next => { api = next; },
    requests,
    restore: () => { globalThis.fetch = previous; },
  };
}
