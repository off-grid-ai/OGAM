import { installNativeBoundary, requireRTL, MB, GB } from '../../harness/nativeBoundary';

// Two pop-ups raised at the same moment are both seen, one after the other. Journey: the user taps
// four files of one model; three start and the fourth waits in the three-at-a-time queue. The phone
// fills up. When a running download finishes, two things happen together: that model is ready (the
// "is ready" pop-up) and the queued download is refused for space (the "Download Failed" pop-up).
// The user sees both; neither replaces the other.
const modelId = 'ibm-granite/granite-4.0-micro-GGUF';
const files = [
  'granite-4.0-micro-Q4_K_M.gguf',
  'granite-4.0-micro-Q5_K_M.gguf',
  'granite-4.0-micro-Q6_K.gguf',
  'granite-4.0-micro-Q8_0.gguf',
];
// 1.5 GB fits the Models screen's RAM rule on any phone, so every file is offered.
const fileBytes = 1.5 * GB;

describe('a finished download and a refused queued download', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it('shows the ready pop-up and the refusal pop-up, one after the other', async () => {
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

    // After: one of the two pop-ups is on screen; closing it brings the other one.
    const ready = 'granite-4.0-micro-GGUF is ready';
    const failed = 'Download Failed';
    const refusal = `Not enough space. This needs ${formatFileSize(fileBytes + 500 * MB)} and your phone has ${formatFileSize(freeNow)} free. Free up space in Settings → Storage, then try again.`;
    await rtl.waitFor(() => expect(screen.queryByText(ready) ?? screen.queryByText(failed)).toBeTruthy());
    const readyFirst = screen.queryByText(ready) !== null;
    expect(screen.queryByText(readyFirst ? failed : ready)).toBeNull();

    // The user closes the first pop-up with its own button.
    rtl.fireEvent.press(screen.getByLabelText(readyFirst ? 'Later' : 'OK'));
    await rtl.waitFor(() => expect(screen.getByText(readyFirst ? failed : ready)).toBeTruthy());
    expect(screen.queryByText(readyFirst ? ready : failed)).toBeNull();
    // The refusal says how much space it needs and how much is free.
    expect(screen.getAllByText(refusal).length).toBeGreaterThan(0);

    // Closing the second leaves no pop-up.
    rtl.fireEvent.press(screen.getByLabelText(readyFirst ? 'OK' : 'Later'));
    await rtl.waitFor(() => expect(screen.queryByText(readyFirst ? failed : ready)).toBeNull());
    expect(screen.queryByText(readyFirst ? ready : failed)).toBeNull();
    screen.unmount();
  });
});
