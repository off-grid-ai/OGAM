/** ExecuTorch's device cache: transfers finish in cache, then move to the final directory. */
export function installKokoroResourceBoundary(files = new Set<string>()) {
  const fetcher = require('react-native-executorch-bare-resource-fetcher').BareResourceFetcher;
  let hold: { progress: number; finish: () => void; promise: Promise<void> } | undefined;
  let readError: Error | undefined;
  let fetchError: Error | undefined;
  const pathFor = (source: string) => `/docs/react-native-executorch/${source.replace(/^https?:\/\//, '').split('#')[0].replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  fetcher.listDownloadedFiles = async () => {
    if (readError) throw readError;
    return [...files].filter(path => path.startsWith('/docs/react-native-executorch/'));
  };
  fetcher.fetch = async (progress: (value: number) => void, ...sources: string[]) => {
    if (fetchError) throw fetchError;
    const pending = hold;
    hold = undefined;
    if (pending) {
      progress(pending.progress);
      await pending.promise;
    }
    const paths = sources.map(pathFor);
    paths.forEach(path => files.add(path));
    progress(1);
    return paths;
  };
  fetcher.deleteResources = async (...sources: string[]) => {
    sources.forEach(source => files.delete(pathFor(source)));
  };
  const controls = {
    files,
    seedVoice(voice = 'af_heart') {
      for (const source of [
        'en-us/duration_predictor.pte', 'en-us/synthesizer.pte', `voices/${voice}.bin`,
        'en-us/tagger.pt', 'en-us/lexicon.json', 'en-us/phonemizer.pte',
      ]) files.add(pathFor(`https://example.test/kokoro/${source}`));
    },
    holdNext(progress: number) {
      let finish!: () => void;
      const promise = new Promise<void>(resolve => { finish = resolve; });
      hold = { progress, finish, promise };
      return finish;
    },
    failReads(error?: Error) { readError = error; },
    failFetch(error?: Error) { fetchError = error; },
  };
  installed = controls;
  return controls;
}

let installed: ReturnType<typeof installKokoroResourceBoundary> | undefined;

/**
 * The cache installed for the current launch. A launch helper installs the cache itself, so a test
 * reaches it here (e.g. in a pre-render hook) to make the device's directory read fail.
 */
export function currentKokoroResourceBoundary() {
  if (!installed) throw new Error('installKokoroResourceBoundary() has not run in this module graph');
  return installed;
}
