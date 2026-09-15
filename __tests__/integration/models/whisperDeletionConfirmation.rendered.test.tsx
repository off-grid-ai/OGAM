import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';

describe('Speech model deletion from the Home picker', () => {
  it('keeps the file on Cancel and removes only the named file on Remove', async () => {
    const boundary = installNativeBoundary({ fs: true });
    const React = require('react');
    const rtl = requireRTL();
    const { whisperService } = require('../../../src/services/whisperService');
    const { useWhisperStore } = require('../../../src/stores/whisperStore');
    const { WhisperPickerSheet } = require('../../../src/components/models/WhisperPickerSheet');
    const path = whisperService.getModelPath('base.en');
    boundary.fs!.seedFile(path, 142 * MB);
    await rtl.act(async () => { await useWhisperStore.getState().refreshPresentModels(); });

    const view = rtl.render(React.createElement(WhisperPickerSheet, { visible: true, onClose: () => {} }));
    const deleteButton = await rtl.waitFor(() => view.getByLabelText('Delete Base transcription model'));
    rtl.fireEvent.press(deleteButton);
    expect(view.getByText('Delete "Base"? This will free up about 142 MB.')).toBeTruthy();
    await rtl.act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    rtl.fireEvent.press(view.getByText('Cancel'));
    expect(await boundary.fs!.exists(path)).toBe(true);

    rtl.fireEvent.press(
      await rtl.waitFor(() =>
        view.getByLabelText('Delete Base transcription model'),
      ),
    );
    await rtl.act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    rtl.fireEvent.press(view.getByText('Remove'));
    await rtl.waitFor(async () => { expect(await boundary.fs!.exists(path)).toBe(false); });
  });
});
