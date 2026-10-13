/** Download Manager classifies a voice transfer through the real engine, provider and screen. */
import { launchVoiceApp } from '../harness/proHarness';

jest.unmock('@react-navigation/native');

it('a mid-download Kokoro appears in Active Downloads at 50%, not as a completed row', async () => {
  const app = await launchVoiceApp();
  const finish = app.cache.holdNext(0.5);
  try {
    await app.voicePanel();
    app.rtl.fireEvent.press(await app.view.findByTestId('voice-model-kokoro-download'));
    await app.view.findByText(/50%/);
    app.rtl.fireEvent.press(app.view.getByTestId('downloads-icon'));
    expect(await app.view.findByText('50%')).toBeTruthy();
    expect(app.view.getByText('Active Downloads')).toBeTruthy();
    expect(app.view.getByTestId('dm-active-downloading-count')).toHaveTextContent('1');
    expect(app.view.getByLabelText('Remove Kokoro TTS')).toBeTruthy();
    expect(app.rtl.within(app.view.getByLabelText('Kokoro TTS')).queryByLabelText('Delete model')).toBeNull();
    await app.rtl.act(async () => { finish(); });
  } finally { finish(); await app.close(); }
});

it('a genuinely completed Kokoro appears under Downloaded Models', async () => {
  const app = await launchVoiceApp();
  try {
    await app.voicePanel();
    await app.downloadVoice();
    app.rtl.fireEvent.press(app.view.getByTestId('downloads-icon'));
    expect(app.rtl.within(await app.view.findByLabelText('Kokoro TTS')).getByLabelText('Delete model')).toBeTruthy();
    expect(app.view.getByText('Downloaded Models')).toBeTruthy();
    expect(app.view.queryByText('Active Downloads')).toBeNull();
  } finally { await app.close(); }
});
