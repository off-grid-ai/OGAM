/**
 * A downloaded transcription model's card says when it arrived, read from the file's own time on the
 * device, and is filed under "Speech" like its chip. Real DownloadManagerScreen, whisperService and
 * useVoiceDownloadItems over the in-memory filesystem (harness/nativeBoundary).
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

describe('Downloads — a Speech row shows its date', () => {
  it('shows the day the whisper file arrived on its facts line, and Speech rather than Transcription', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    boundary.fs!.seedFile(`${boundary.fs!.DocumentDirectoryPath}/whisper-models/ggml-tiny.en.bin`, 75 * 1024 * 1024);
    const React = require('react');
    const { render, waitFor } = requireRTL();
    const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');
    const { formatShortDate } = require('../../../src/utils/localTime');
    const RNFS = require('react-native-fs');
    const { mtime } = await RNFS.stat(`${boundary.fs!.DocumentDirectoryPath}/whisper-models/ggml-tiny.en.bin`);

    const view = render(React.createElement(DownloadManagerScreen, {}));
    await waitFor(() => { expect(view.queryByText(/Whisper Tiny/)).not.toBeNull(); });

    const date = formatShortDate(mtime);
    expect(view.getByText(new RegExp(`· ${date}$`))).toBeTruthy();
    expect(view.queryByText(/Transcription/)).toBeNull();
    view.unmount();
  });
});
