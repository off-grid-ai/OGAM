/**
 * UI (rendered) — while a text model loads, the spinner sits ON the selected model row (next to it),
 * NOT in a banner over the list (device request 2026-07-14: the top "Loading model..." banner looked ugly).
 *
 * Real ModelSelectorModal over the real store; fake only the native boundary. The loading indicator is
 * a prop-driven presentational state (isLoading + the selected model), so this mounts the selector with a
 * model selected and isLoading true and asserts WHERE the spinner renders.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

describe('model selector loader — spinner on the selected row, not a banner', () => {
  function mount(isLoading: boolean) {
    installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const rtl = requireRTL();
    const { useAppStore } = require('../../../src/stores');
    const { ModelSelectorModal } = require('../../../src/components/ModelSelectorModal');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const model = createDownloadedModel({ id: 'm', name: 'Gemma 4 E2B', engine: 'llama', filePath: '/models/g.gguf', fileName: 'g.gguf' });
    // Selected but not yet loaded (the mid-load state): activeModelId set, currentModelPath still null.
    useAppStore.setState({ downloadedModels: [model], activeModelId: 'm' });
    const view = rtl.render(React.createElement(ModelSelectorModal, {
      visible: true, onClose: () => {}, onSelectModel: () => {}, onUnloadModel: () => {},
      isLoading, currentModelPath: null,
    }));
    return { rtl, view };
  }

  it('shows the row spinner (not the banner) while loading', async () => {
    const { rtl, view } = mount(true);
    // The inline row spinner is present...
    await rtl.waitFor(() => { expect(view.queryByTestId('model-row-loading')).not.toBeNull(); }, { timeout: 4000 });
    // ...and the old over-the-list banner is gone.
    expect(view.queryByText('Loading model...')).toBeNull();
  });

  it('falsify: no spinner when nothing is loading', async () => {
    const { rtl, view } = mount(false);
    await rtl.waitFor(() => { expect(view.queryByText('Gemma 4 E2B')).not.toBeNull(); }, { timeout: 4000 });
    expect(view.queryByTestId('model-row-loading')).toBeNull();
  });
});
