/**
 * UI (rendered) — DEVICE 2026-07-14: switching a text model's backend (GPU→NPU for llama gguf, CPU↔GPU
 * for litert) keeps the SAME model id, so it's a RELOAD of the already-active model. The "Settings changed
 * — tap to reload model" card opens the model sheet and reloads that model WITHOUT the user tapping a row.
 * The per-row spinner was keyed only on the just-tapped row (loadingTextModelId), so with no tap the sheet
 * opened with the active row highlighted-but-idle and NO spinner — "feels weird / looks broken".
 *
 * Real ModelSelectorModal over the real store; fake only the native boundary. Model A is loaded AND active;
 * NO row is tapped; the parent flips isLoading true (the reload began). The spinner must appear on A — the
 * active model being reloaded. Sibling of selectorLoaderOnRow (the just-tapped-row case).
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

describe('model selector loader — spinner on the active row during a no-tap reload (settings-changed card)', () => {
  it('reloading the already-active model (no row tapped) puts the spinner on the active row', async () => {
    installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const rtl = requireRTL();
    const { useAppStore } = require('../../../src/stores');
    const { ModelSelectorModal } = require('../../../src/components/ModelSelectorModal');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const A = createDownloadedModel({ id: 'a', name: 'Model A', engine: 'llama', filePath: '/models/a.gguf', fileName: 'a.gguf' });
    const B = createDownloadedModel({ id: 'b', name: 'Model B', engine: 'llama', filePath: '/models/b.gguf', fileName: 'b.gguf' });
    // A is the ACTIVE model and it is currently loaded — the exact state when the "settings changed" card
    // fires: the user did not switch models, they changed a backend/setting for the active one.
    useAppStore.setState({ downloadedModels: [A, B], activeModelId: 'a' });

    const props = {
      visible: true, onClose: () => {}, onSelectModel: () => {}, onUnloadModel: () => {},
      isLoading: false, currentModelPath: '/models/a.gguf',
    };
    const view = rtl.render(React.createElement(ModelSelectorModal, props));

    // Nothing is loading yet — no row shows a spinner. (So a later spinner is a real observed transition,
    // not something that was always on screen.)
    await rtl.waitFor(() => view.getByTestId('text-model-row-a'));
    expect(view.queryByTestId('model-row-loading')).toBeNull();

    // The reload begins with NO row tapped (the card opened the sheet and kicked the load): isLoading → true.
    // RED on the old code: loadingTextModelId is null (no tap) → loadingModelId is null → no spinner anywhere.
    view.rerender(React.createElement(ModelSelectorModal, { ...props, isLoading: true, currentModelPath: null }));

    // The spinner is on A — the active model being reloaded — even though the user tapped nothing.
    await rtl.waitFor(() => {
      expect(rtl.within(view.getByTestId('text-model-row-a')).queryByTestId('model-row-loading')).not.toBeNull();
    }, { timeout: 4000 });
    // and not on the other row.
    expect(rtl.within(view.getByTestId('text-model-row-b')).queryByTestId('model-row-loading')).toBeNull();

    // Load finishes (isLoading → false) → the spinner clears (no stuck spinner).
    view.rerender(React.createElement(ModelSelectorModal, { ...props, isLoading: false, currentModelPath: '/models/a.gguf' }));
    await rtl.waitFor(() => {
      expect(view.queryByTestId('model-row-loading')).toBeNull();
    }, { timeout: 4000 });
  });
});
