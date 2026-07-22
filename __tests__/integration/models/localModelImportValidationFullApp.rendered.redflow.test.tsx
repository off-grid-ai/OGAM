import { renderMainApp } from '../../harness/appJourney';

describe('APP-P1-006 local model import validation', () => {
  it('accepts a compatible GGUF and clearly rejects incompatible and partial files', async () => {
    const { boundary, rtl, view } = await renderMainApp();
    const picker = require('@react-native-documents/picker');
    const validName = 'compatible-Q4_K_M.gguf';
    const partialName = 'partial-Q4_K_M.gguf';
    boundary.fs!.seedFile(`/docs/incoming/${validName}`, 2048);
    boundary.fs!.seedFile(`/docs/incoming/${partialName}`, 128);

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );

    picker.pick.mockResolvedValueOnce([
      {
        uri: `file:///docs/incoming/${validName}`,
        name: validName,
        size: 2048,
      },
    ]);
    rtl.fireEvent.press(view.getByTestId('import-local-model'));
    await rtl.waitFor(() => {
      expect(view.getByText('Success')).toBeTruthy();
      expect(view.getByText(/compatible imported successfully/i)).toBeTruthy();
    });
    rtl.fireEvent.press(view.getByText('OK'));

    picker.pick.mockResolvedValueOnce([
      {
        uri: 'file:///docs/incoming/notes.bin',
        name: 'notes.bin',
        size: 2048,
      },
    ]);
    rtl.fireEvent.press(view.getByTestId('import-local-model'));
    await rtl.waitFor(() => {
      expect(view.getByText('Invalid File')).toBeTruthy();
      expect(view.getByText(/Supported formats: .gguf/i)).toBeTruthy();
    });
    rtl.fireEvent.press(view.getByText('OK'));

    picker.pick.mockResolvedValueOnce([
      {
        uri: `file:///docs/incoming/${partialName}`,
        name: partialName,
        size: 128,
      },
    ]);
    rtl.fireEvent.press(view.getByTestId('import-local-model'));
    await rtl.waitFor(() => {
      expect(view.getByText('Import Failed')).toBeTruthy();
      expect(view.getByText(/too small.*incomplete/i)).toBeTruthy();
    });
    rtl.fireEvent.press(view.getByText('OK'));

    rtl.fireEvent.press(view.getByTestId('downloads-icon'));
    await rtl.waitFor(() => {
      expect(
        view.getByTestId(
          'completed-download-local_import/compatible-Q4_K_M.gguf',
        ),
      ).toBeTruthy();
      expect(view.queryByText(partialName)).toBeNull();
      expect(view.queryByText('notes.bin')).toBeNull();
    });
  }, 30000);
});
