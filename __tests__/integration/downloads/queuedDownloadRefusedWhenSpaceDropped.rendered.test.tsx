import { installNativeBoundary, requireRTL, MB, GB } from '../../harness/nativeBoundary';

// A download that waits in the three-at-a-time queue must check free space when it actually
// STARTS, against the space free at that moment — not the space free when the user tapped it.
// Journey: the phone has plenty of room; the user taps four files of one model. Three start, the
// fourth waits its turn. While they run, the phone fills up. When a running download finishes and
// the queued one would start, the user sees it refused with how much it needs and how much is free,
// and it never reaches the native downloader.
const modelId = 'ibm-granite/granite-4.0-micro-GGUF';
const files = [
  'granite-4.0-micro-Q4_K_M.gguf',
  'granite-4.0-micro-Q5_K_M.gguf',
  'granite-4.0-micro-Q6_K.gguf',
  'granite-4.0-micro-Q8_0.gguf',
];
// 1.5 GB fits the Models screen's RAM rule on any phone, so every file is offered.
const fileBytes = 1.5 * GB;

describe('a queued download checks free space when it starts', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('refuses the queued download with the space it needs and the space free, and never starts it', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true, ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 8 * GB } });
    boundary.fs!.setFreeBytes(64 * GB);
    global.fetch = async input => {
      const url = String(input);
      const body = url.includes(`/api/models/${modelId}?blobs=true`)
        ? { id: modelId, siblings: files.map(rfilename => ({ rfilename, size: fileBytes })) }
        : url.includes('search=granite')
          ? [{ id: modelId, author: 'ibm-granite', downloads: 1000, likes: 20, tags: ['gguf'] }]
          : [];
      return { ok: true, status: 200, json: async () => body } as Response;
    };
    const React = require('react');
    const rtl = requireRTL();
    const { formatFileSize } = require('@offgrid/models');
    const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
    registerCoreDownloadProviders();

    const screen = rtl.render(React.createElement(ModelsScreen, {}));
    rtl.fireEvent.changeText(screen.getByTestId('search-input'), 'granite');
    rtl.fireEvent(screen.getByTestId('search-input'), 'submitEditing');
    await rtl.waitFor(() => expect(screen.getByText('granite-4.0-micro-GGUF')).toBeTruthy());
    rtl.fireEvent.press(screen.getByText('granite-4.0-micro-GGUF'));
    // The model opens on its recommended file; the user taps "All files" to see every file.
    await rtl.waitFor(() => expect(screen.getByTestId('all-files-toggle')).toBeTruthy());
    rtl.fireEvent.press(screen.getByTestId('all-files-toggle'));
    await rtl.waitFor(() => expect(screen.getByTestId('file-card-3-download')).toBeTruthy());

    // Before: nothing downloading, no failure on screen, all four files offered.
    expect(boundary.download!.active()).toHaveLength(0);
    expect(screen.queryByText('Download Failed')).toBeNull();
    expect(screen.queryByLabelText('Cancel download')).toBeNull();

    // The user taps the first three files while there is plenty of room: all three start.
    for (const i of [0, 1, 2]) {
      rtl.fireEvent.press(screen.getByTestId(`file-card-${i}-download`));
      await rtl.waitFor(() => expect(boundary.download!.active()).toHaveLength(i + 1));
    }
    // Then the fourth: the three-at-a-time cap holds it in the queue, not on the native downloader.
    rtl.fireEvent.press(screen.getByTestId('file-card-3-download'));
    await rtl.act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const running = boundary.download!.active();
    expect(running).toHaveLength(3);
    const queuedFile = files.find(f => !running.some(r => r.fileName === f))!;
    expect(queuedFile).toBeDefined();
    expect(screen.queryByText('Download Failed')).toBeNull();
    expect(screen.queryByText(/Not enough space/)).toBeNull();

    // While the three run, the phone fills up.
    const freeNow = 1 * GB;
    boundary.fs!.setFreeBytes(freeNow);

    // One running download finishes: its slot frees and the queued download tries to start.
    const done = running[0];
    await rtl.act(async () => {
      boundary.fs!.seedFile(`/docs/models/${done.fileName}`, fileBytes);
      boundary.download!.events.emit('DownloadComplete', {
        downloadId: done.downloadId,
        fileName: done.fileName,
        modelId: done.modelId,
        bytesDownloaded: fileBytes,
        totalBytes: fileBytes,
        status: 'completed',
        localUri: `/docs/models/${done.fileName}`,
      });
      await new Promise(r => setTimeout(r, 0));
      await new Promise(r => setTimeout(r, 0));
    });

    // After: the queued download is refused, in plain words, with the space it needs and the space
    // free right now (not the 64 GB free when it was tapped), on its own file card.
    const refusal = `Not enough space. This needs ${formatFileSize(fileBytes + 500 * MB)} and your phone has ${formatFileSize(freeNow)} free. Free up space in Settings → Storage, then try again.`;
    // (It shows on the file card and in the Download Failed pop-up, so it appears more than once.)
    await rtl.waitFor(() => expect(screen.getAllByText(refusal).length).toBeGreaterThan(0));
    // The queued file never reached the native downloader.
    expect(boundary.download!.active().some(r => r.fileName === queuedFile)).toBe(false);
    screen.unmount();
  });
});
