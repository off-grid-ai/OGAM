/**
 * Settings > Document search lists the search (embedding) models.
 *
 * SPEC (OGAM user's view): a model already on the phone shows its size ("35 MB"); one you would
 * still fetch says "125 MB download". Its trailing mark says what a tap does: an empty circle picks
 * a model that is here, a download mark gets one that is not. The built-in MiniLM is always here, so
 * once another model is in use it shows the circle too.
 *
 * Everything we own runs (the tab, ModelCard, embeddingService.hasModelFile, the documents.db store).
 * Device leaves only (harness/documentEngine): SQLite is a real in-memory engine, the filesystem memfs.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';
import { installDocumentEngine } from '../../harness/documentEngine';

function setup() {
  const boundary = installNativeBoundary({ fs: true, ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 6 * GB } });
  installDocumentEngine(boundary.fs!);
  const disk = boundary.fs!;
  const fs = disk.module;
  const { sha256 } = require('js-sha256');
  const { RECOMMENDED_EMBEDDING_MODELS } = require('../../../src/services/huggingFaceModelBrowser');
  const store = require('../../../src/services/documents/store');
  const [english, multilingual] = RECOMMENDED_EMBEDDING_MODELS as { id: string; name: string; size: number }[];
  /** Put a model's file on the phone at the path and size the app checks. */
  const onPhone = async (model: { id: string; size: number }) => {
    const path = `${fs.DocumentDirectoryPath}/embedding-${sha256(model.id)}.gguf`;
    disk.seedFile(path, model.size);
  };
  return { store, english, multilingual, onPhone };
}

async function renderTab() {
  const React = require('react');
  const rtl = requireRTL();
  const { EmbeddingModelsTab } = require('../../../src/screens/ModelsScreen/EmbeddingModelsTab');
  const view = rtl.render(React.createElement(EmbeddingModelsTab));
  await view.findByTestId('embedding-models-tab');
  /** The row named for a model, and the icon names inside it. */
  const row = (name: string) => rtl.within(view.getByLabelText(name));
  const icons = (name: string) =>
    view
      .getByLabelText(name)
      .findAll((node: { type: unknown }) => node.type === 'Icon')
      .map((node: { props: Record<string, unknown> }) => String(node.props.name));
  return { rtl, view, row, icons };
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

it('a model on the phone shows its size and a circle; one that is not says download and shows a download mark', async () => {
  const h = setup();
  await h.onPhone(h.english);
  const { rtl, row, icons } = await renderTab();

  // The facts line ends with the size alone ("Q8_0 · English · 35 MB").
  await rtl.waitFor(() => expect(row(h.english.name).getByText(new RegExp(`· ${mb(h.english.size)}$`))).toBeTruthy());
  expect(row(h.english.name).queryByText(/download/)).toBeNull();
  expect(icons(h.english.name)).toContain('circle');
  expect(icons(h.english.name)).not.toContain('download');

  expect(row(h.multilingual.name).getByText(new RegExp(`· ${mb(h.multilingual.size)} download$`))).toBeTruthy();
  expect(icons(h.multilingual.name)).toContain('download');
  expect(icons(h.multilingual.name)).not.toContain('circle');
});

it('the built-in model shows the circle once another model is in use, and none while it is the one in use', async () => {
  const h = setup();
  await h.onPhone(h.english);
  const builtIn = 'MiniLM (built-in)';

  const first = await renderTab();
  expect(first.icons(builtIn)).not.toContain('circle');
  first.view.unmount();

  h.store.commitEmbeddingModel({ id: h.english.id, name: h.english.name, filePath: '/models/l12.gguf', size: h.english.size });
  const second = await renderTab();
  await second.rtl.waitFor(() => expect(second.icons(builtIn)).toContain('circle'));
  // The model in use has no mark: there is nothing to pick or get.
  expect(second.icons(h.english.name)).not.toContain('circle');
  expect(second.icons(h.english.name)).not.toContain('download');
});
