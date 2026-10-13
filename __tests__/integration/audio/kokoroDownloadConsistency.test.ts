/** Both real screens must agree about the device cache and an in-flight transfer. */
import { launchVoiceApp } from '../../harness/proHarness';

jest.unmock('@react-navigation/native');

async function downloads(app: Awaited<ReturnType<typeof launchVoiceApp>>) {
  app.rtl.fireEvent.press(app.view.getByTestId('downloads-icon'));
  await app.view.findByTestId('downloaded-models-screen');
}

it('mid-download: all prior files present must not make either screen report completed', async () => {
  const app = await launchVoiceApp();
  const finish = app.cache.holdNext(0.61);
  try {
    await app.voicePanel();
    app.rtl.fireEvent.press(await app.view.findByTestId('voice-model-kokoro-download'));
    app.cache.seedVoice(); // A previous complete copy can still exist during a new transfer.
    expect(await app.view.findByText(/61%/)).toBeTruthy();
    expect(app.view.queryByTestId('voice-model-kokoro-delete')).toBeNull();
    await downloads(app);
    expect(await app.view.findByText('61%')).toBeTruthy();
    expect(app.view.getByText('Active Downloads')).toBeTruthy();
    expect(app.view.getByTestId('dm-active-downloading-count')).toHaveTextContent('1');
    expect(app.view.getByLabelText('Remove Kokoro TTS')).toBeTruthy();
    expect(app.rtl.within(app.view.getByLabelText('Kokoro TTS')).queryByLabelText('Delete model')).toBeNull();
    await app.rtl.act(async () => { finish(); });
  } finally {
    finish();
    await app.close();
  }
});

it('genuinely complete: a resolved transfer reads as completed in both screens', async () => {
  const app = await launchVoiceApp();
  try {
    await app.voicePanel();
    await app.downloadVoice();
    await downloads(app);
    expect(app.rtl.within(await app.view.findByLabelText('Kokoro TTS')).getByLabelText('Delete model')).toBeTruthy();
    expect(app.view.getByText('Downloaded Models')).toBeTruthy();
    expect(app.view.queryByText('Active Downloads')).toBeNull();
  } finally { await app.close(); }
});

it('persisted completion and its files still read as completed after boot', async () => {
  const first = await launchVoiceApp();
  await first.voicePanel();
  await first.downloadVoice();
  await first.close();
  const app = await launchVoiceApp({ files: first.cache.files, preserveStorage: true });
  try {
    await app.voicePanel();
    expect(await app.view.findByTestId('voice-model-kokoro-delete')).toBeTruthy();
    await downloads(app);
    expect(app.rtl.within(await app.view.findByLabelText('Kokoro TTS')).getByLabelText('Delete model')).toBeTruthy();
  } finally { await app.close(); }
});

it('partial core files without the voice assets do not read as completed', async () => {
  const app = await launchVoiceApp();
  try {
    app.cache.files.add('/docs/react-native-executorch/example.test_kokoro_en-us_duration_predictor.pte');
    app.cache.files.add('/docs/react-native-executorch/example.test_kokoro_en-us_synthesizer.pte');
    await app.voicePanel();
    expect(await app.view.findByTestId('voice-model-kokoro-download')).toBeTruthy();
    expect(app.view.queryByTestId('voice-model-kokoro-delete')).toBeNull();
    await downloads(app);
    expect(app.view.queryByLabelText('Remove Kokoro TTS')).toBeNull();
    expect(app.view.queryByText('Kokoro TTS')).toBeNull();
  } finally { await app.close(); }
});
