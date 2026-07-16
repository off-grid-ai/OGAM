/**
 * UI (rendered) — the load spinner sits on the row the user JUST TAPPED, not on the previously-active
 * one (device 2026-07-14: model A was loaded, user tapped B, and the spinner showed on A). During a
 * switch the newly-tapped model isn't `active` yet (activeModelId/currentModelPath still point at the
 * old model), so keying the spinner off "is active" put it on the wrong row.
 *
 * Real ModelSelectorModal over the real store; fake only the native boundary. Text switch: A is loaded,
 * tap B (row enabled), then the parent flips isLoading true (the load began) → the spinner must be on B.
 * The image tab shares the identical loadingModelId → row-spinner mechanism (same fix).
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

describe('model selector loader — spinner on the just-tapped row, not the old active one', () => {
  it('switching from the loaded model to another puts the spinner on the NEW row', async () => {
    installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const rtl = requireRTL();
    const { useAppStore } = require('../../../src/stores');
    const { ModelSelectorModal } = require('../../../src/components/ModelSelectorModal');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const A = createDownloadedModel({ id: 'a', name: 'Model A', engine: 'llama', filePath: '/models/a.gguf', fileName: 'a.gguf' });
    const B = createDownloadedModel({ id: 'b', name: 'Model B', engine: 'llama', filePath: '/models/b.gguf', fileName: 'b.gguf' });
    useAppStore.setState({ downloadedModels: [A, B], activeModelId: 'a' });

    const onSelectModel = jest.fn();
    // A is the currently-LOADED model; nothing is loading yet (rows tappable).
    const props = {
      visible: true, onClose: () => {}, onSelectModel, onUnloadModel: () => {},
      isLoading: false, currentModelPath: '/models/a.gguf',
    };
    const view = rtl.render(React.createElement(ModelSelectorModal, props));

    // Tap B — the row just tapped. handleSelectLocalModel records it as the loading row.
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('text-model-row-b')));
    expect(onSelectModel).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));

    // The parent now begins loading (isLoading → true), still on A's path until B finishes.
    view.rerender(React.createElement(ModelSelectorModal, { ...props, isLoading: true }));

    // The spinner is on B (the tapped row) — NOT on A (the still-loaded one).
    // RED on the old code: A was `isActive` (loaded) so the spinner rendered inside A's row.
    await rtl.waitFor(() => {
      expect(rtl.within(view.getByTestId('text-model-row-b')).queryByTestId('model-row-loading')).not.toBeNull();
    }, { timeout: 4000 });
    expect(rtl.within(view.getByTestId('text-model-row-a')).queryByTestId('model-row-loading')).toBeNull();
  });
});
