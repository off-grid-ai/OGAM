/**
 * HAPPY / GREEN-GUARD (UI, rendered) — T012 (DEV · WORKS): the ModelsScreen must reflect exactly N
 * downloaded models. Seed N downloaded models at the DEVICE BOUNDARY (a persisted
 * `@local_llm/downloaded_models` record + the model file on the in-memory disk — exactly what a real
 * download leaves), mount the REAL ModelsScreen, and assert the rendered downloaded-indicator count == N.
 *
 * SURFACE NOTE (grounded in the real code): ModelsScreen has NO aggregate "solid downloaded-count badge".
 * The only count badge in the header (`downloads-badge-count`) is the IN-FLIGHT/active-download count
 * (that is T001, not this row). The per-type downloaded count numeral (`model-summary-count-{type}`) lives
 * on the HOME ModelsSummaryRow and is covered by T097 — it is NOT a ModelsScreen surface. The genuine
 * surface on ModelsScreen that reflects "N models are downloaded" is the per-card DOWNLOADED indicator: a
 * downloaded recommended-model card renders the `check-circle` "downloaded" mark instead of a download
 * button. So the downloaded-count == N is asserted as: exactly N rendered cards show the downloaded mark.
 *
 * A `testID` was added to that existing indicator (src/components/ModelCardContent.tsx → the bare
 * `check-circle` in DownloadedActions) so the count is observable without matching an icon internal:
 * `model-card-{index}-downloaded`.
 *
 * Real stack over the fs + AsyncStorage boundary: the REAL useTextModels hydration
 * (modelManager.getDownloadedModels → loadDownloadedModels → validateAndResolveModels, which really
 * probes the disk) runs, the REAL recommended list matches downloaded rows by id-prefix, and the REAL
 * ModelCard renders the mark. The N is EMERGENT from the seeded boundary, not programmed.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

// Three recommended-model ids that render at the default 12GB RAM profile (params ≤ 13B). A downloaded
// row whose id STARTS WITH a recommended id makes that recommended card render its downloaded mark
// (the real match rule: downloadedModels.some(m => m.id.startsWith(item.id))).
const RECOMMENDED_IDS = [
  'unsloth/gemma-4-E2B-it-GGUF',
  'unsloth/Qwen3.5-0.8B-GGUF',
  'unsloth/Qwen3.5-2B-GGUF',
];

async function mountWithNDownloaded(n: number) {
  const boundary = installNativeBoundary({ fs: true });
  /* eslint-disable @typescript-eslint/no-var-requires */
  const React = require('react');
  const { render, waitFor } = requireRTL();
  const AsyncStorage = require('@react-native-async-storage/async-storage').default
    ?? require('@react-native-async-storage/async-storage');
  const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const docs = boundary.fs!.DocumentDirectoryPath;
  // Seed N downloaded models: a file on the in-memory disk + a persisted record whose id is prefixed by
  // a recommended id (so the recommended card recognises it as downloaded). This is the ONLY thing
  // pre-placed — a genuine device-boundary leaf (a completed download), never our own store state.
  const rows = RECOMMENDED_IDS.slice(0, n).map((recId, i) => {
    const fileName = `${recId.split('/').pop()}-Q4_K_M.gguf`;
    const filePath = `${docs}/models/${fileName}`;
    boundary.fs!.seedFile(filePath, 500 * 1024 * 1024);
    return createDownloadedModel({ id: `${recId}/${fileName}`, name: `Downloaded ${i}`, engine: 'llama', filePath, fileName });
  });
  await AsyncStorage.setItem('@local_llm/downloaded_models', JSON.stringify(rows));

  const view = render(React.createElement(ModelsScreen, {}));
  return { view, waitFor };
}

describe('T012 (rendered) — ModelsScreen reflects N downloaded models', () => {
  it('renders exactly N downloaded-indicator marks when N models are downloaded', async () => {
    const N = 3;
    const { view, waitFor } = await mountWithNDownloaded(N);

    // The recommended list is present (it renders on mount, no search needed).
    await waitFor(() => { expect(view.getByTestId('models-list')).not.toBeNull(); });

    // The count of downloaded marks the user sees on ModelsScreen must equal N.
    await waitFor(() => {
      expect(view.queryAllByTestId(/^model-card-\d+-downloaded$/)).toHaveLength(N);
    }, { timeout: 4000 });
  });
});
