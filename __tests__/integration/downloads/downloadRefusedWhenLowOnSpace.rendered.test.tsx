import { installNativeBoundary, requireRTL, MB, GB } from '../../harness/nativeBoundary';

// A phone without room for a model must refuse the download up front with a plain message,
// instead of starting it and failing at 90% when the disk fills. The model is a Hugging Face
// search result outside the shared catalog, so its file list (and size) comes from the HF API.
const modelId = 'ibm-granite/granite-4.0-micro-GGUF';
const fileName = 'granite-4.0-micro-Q8_0.gguf';
// 1.5 GB fits the Models screen's RAM rule on any phone, so the file is offered before boot
// has read the real RAM; only the free-space check stands between the tap and the download.
const fileBytes = 1.5 * GB;

async function openModelFiles(freeBytes: number | 'unreadable') {
  const boundary = installNativeBoundary({ download: true, fs: true, ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 8 * GB } });
  if (freeBytes === 'unreadable') {
    boundary.fs!.module.getFSInfo.mockRejectedValue(new Error('statfs failed'));
  } else {
    boundary.fs!.setFreeBytes(freeBytes);
  }
  global.fetch = async input => {
    const url = String(input);
    const body = url.includes(`/api/models/${modelId}?blobs=true`)
      ? { id: modelId, siblings: [{ rfilename: fileName, size: fileBytes }] }
      : url.includes('search=granite')
        ? [{ id: modelId, author: 'ibm-granite', downloads: 1000, likes: 20, tags: ['gguf'] }]
        : [];
    return { ok: true, status: 200, json: async () => body } as Response;
  };
  const React = require('react');
  const rtl = requireRTL();
  const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
  const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
  registerCoreDownloadProviders();

  const screen = rtl.render(React.createElement(ModelsScreen, {}));
  rtl.fireEvent.changeText(screen.getByTestId('search-input'), 'granite');
  rtl.fireEvent(screen.getByTestId('search-input'), 'submitEditing');
  await rtl.waitFor(() => expect(screen.getByText('granite-4.0-micro-GGUF')).toBeTruthy());
  rtl.fireEvent.press(screen.getByText('granite-4.0-micro-GGUF'));
  await rtl.waitFor(() => expect(screen.getByText('granite-4.0-micro-Q8_0')).toBeTruthy());

  // Before the tap: nothing is downloading and no failure is on screen.
  expect(boundary.download!.active()).toHaveLength(0);
  expect(screen.queryByText('Download Failed')).toBeNull();
  expect(screen.queryByLabelText('Cancel download')).toBeNull();
  expect(screen.getAllByLabelText(/^Download /).length).toBeGreaterThan(0);
  return { boundary, rtl, screen };
}

describe('download refused when the phone is low on space', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('shows how much space the model needs and how much is free, and starts no download', async () => {
    const { formatFileSize } = require('@offgrid/models');
    const { boundary, rtl, screen } = await openModelFiles(1 * GB);

    rtl.fireEvent.press(screen.getAllByLabelText(/^Download /)[0]);

    // Exactly one alert: the detail view used to mount a second copy of the screen's alert.
    await rtl.waitFor(() => expect(screen.getAllByText('Download Failed')).toHaveLength(1));
    const needs = formatFileSize(fileBytes + 500 * MB);
    const free = formatFileSize(1 * GB);
    expect(screen.getAllByText(
      `Not enough space. This needs ${needs} and your phone has ${free} free. Free up space in Settings → Storage, then try again.`,
    // In the alert, and on the failed download's own card.
    )).not.toHaveLength(0);
    expect(boundary.download!.active()).toHaveLength(0);
    expect(screen.queryByLabelText('Cancel download')).toBeNull();
    screen.unmount();
  });

  it('starts the download when the phone has room for it', async () => {
    const { boundary, rtl, screen } = await openModelFiles(64 * GB);

    rtl.fireEvent.press(screen.getAllByLabelText(/^Download /)[0]);

    // The native downloader received the file, and the card turned into an in-flight download.
    await rtl.waitFor(() => expect(boundary.download!.active()).toEqual([expect.objectContaining({ fileName })]));
    await rtl.waitFor(() => expect(screen.getByLabelText('Cancel download')).toBeTruthy());
    expect(screen.queryAllByLabelText(/^Download /)).toHaveLength(0);
    expect(screen.queryByText('Download Failed')).toBeNull();
    screen.unmount();
  });

  it('does not block the download when free space cannot be read', async () => {
    const { boundary, rtl, screen } = await openModelFiles('unreadable');

    rtl.fireEvent.press(screen.getAllByLabelText(/^Download /)[0]);

    // The native downloader received the file, and the card turned into an in-flight download.
    await rtl.waitFor(() => expect(boundary.download!.active()).toEqual([expect.objectContaining({ fileName })]));
    await rtl.waitFor(() => expect(screen.getByLabelText('Cancel download')).toBeTruthy());
    expect(screen.queryAllByLabelText(/^Download /)).toHaveLength(0);
    expect(screen.queryByText('Download Failed')).toBeNull();
    screen.unmount();
  });
});
