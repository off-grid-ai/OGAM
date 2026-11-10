/**
 * Settings > Document search lists the search (embedding) models.
 *
 * SPEC (OGAM user's view): a model already on the phone shows its size ("35 MB"); one you would
 * still fetch says "125 MB download". Its trailing mark says what a tap does: an empty circle picks
 * a model that is here, a download mark gets one that is not. The built-in MiniLM is always here, so
 * once another model is in use it shows the circle too. While a model downloads, its own row shows the
 * progress and the cancel, and nothing else on the tab does (no second loader under the search field).
 * A cancel you asked for leaves no message: the row goes back to its download mark. A failed download
 * says so on its own row, with Retry.
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
  const [english, multilingual] = RECOMMENDED_EMBEDDING_MODELS as { id: string; name: string; size: number; downloadUrl: string }[];
  /** Put a model's file on the phone at the path and size the app checks. */
  const onPhone = async (model: { id: string; size: number }) => {
    const path = `${fs.DocumentDirectoryPath}/embedding-${sha256(model.id)}.gguf`;
    disk.seedFile(path, model.size);
  };
  return { store, english, multilingual, onPhone, disk };
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

it('a download shows on its own row with a cancel, and not again under the search field', async () => {
  const h = setup();
  const transfer = h.disk.serveRemoteFile(h.multilingual.downloadUrl, { body: 'model-bytes', hold: true });
  const { rtl, view, row, icons } = await renderTab();

  rtl.fireEvent.press(view.getByLabelText(h.multilingual.name));
  rtl.fireEvent.press(await view.findByText('Switch'));
  await rtl.waitFor(() => expect(transfer.held()).toBe(true));

  const cancel = await rtl.waitFor(() => row(h.multilingual.name).getByLabelText('Cancel download'));
  expect(view.queryByTestId('embedding-index-progress')).toBeNull();
  expect(view.queryByText('Cancel model change')).toBeNull();

  rtl.fireEvent.press(cancel);
  await rtl.waitFor(() => expect(icons(h.multilingual.name)).toContain('download'));
  expect(row(h.multilingual.name).queryByLabelText('Cancel download')).toBeNull();
  expect(view.queryByText(/cancelled/i)).toBeNull();
  expect(view.queryByRole('alert')).toBeNull();
  expect(h.store.activeEmbeddingModel()).toBeNull();
});

it('a failed download says so on its own row, with Retry, and not under the search field', async () => {
  const h = setup();
  h.disk.serveRemoteFile(h.multilingual.downloadUrl, { statusCode: 500, body: 'error' });
  const { rtl, view, row } = await renderTab();

  rtl.fireEvent.press(view.getByLabelText(h.multilingual.name));
  rtl.fireEvent.press(await view.findByText('Switch'));

  await rtl.waitFor(() => expect(row(h.multilingual.name).getByText(/The previous model is still active\./)).toBeTruthy());
  expect(row(h.multilingual.name).getByLabelText('Retry download')).toBeTruthy();
  expect(view.queryByRole('alert')).toBeNull();
  expect(h.store.activeEmbeddingModel()).toBeNull();

  rtl.fireEvent.press(row(h.multilingual.name).getByLabelText('Remove download'));
  await rtl.waitFor(() => expect(view.queryByText(/The previous model is still active\./)).toBeNull());
});

it('Remove download that cannot check the disk keeps the failure and says why', async () => {
  const h = setup();
  h.disk.serveRemoteFile(h.multilingual.downloadUrl, { statusCode: 500, body: 'error' });
  const { rtl, view, row } = await renderTab();
  rtl.fireEvent.press(view.getByLabelText(h.multilingual.name));
  rtl.fireEvent.press(await view.findByText('Switch'));
  await rtl.waitFor(() => expect(row(h.multilingual.name).getByLabelText('Retry download')).toBeTruthy());

  // The phone's storage cannot be read when Remove is pressed: nothing was removed, so the failure stays.
  const fs = h.disk.module;
  const exists = fs.exists.getMockImplementation();
  fs.exists.mockImplementation(async () => { throw new Error('Storage is not available'); });
  rtl.fireEvent.press(row(h.multilingual.name).getByLabelText('Remove download'));

  await rtl.waitFor(() => expect(view.getByText('Storage is not available')).toBeTruthy());
  expect(row(h.multilingual.name).getByLabelText('Retry download')).toBeTruthy();
  fs.exists.mockImplementation(exists);
});
