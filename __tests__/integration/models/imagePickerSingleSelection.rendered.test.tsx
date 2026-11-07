import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

describe('image model picker selection', () => {
  it('shows only the selected local or remote image model while switching both ways', async () => {
    const boundary = installNativeBoundary({
      fs: true,
      ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 8 * GB },
    });
    const React = require('react');
    const rtl = requireRTL();
    const { createONNXImageModel } = require('../../utils/factories');
    const { useAppStore, useRemoteServerStore } = require('../../../src/stores');
    const { ModelSelectorModal } = require('../../../src/components/ModelSelectorModal');

    const local = createONNXImageModel({
      id: 'local-image',
      name: 'Local Image',
      modelPath: '/models/local-image',
      backend: 'coreml',
      size: 64 * 1024 * 1024,
    });
    boundary.fs!.seedFile('/models/local-image/model.mlmodelc', local.size);
    useAppStore.getState().addDownloadedImageModel(local);
    useRemoteServerStore.getState().clearAllServers();
    useRemoteServerStore.getState().addServer({
      name: 'Studio Mac',
      endpoint: 'http://192.168.1.50:7878', // NOSONAR - private LAN fixture
      providerType: 'openai-compatible',
      mediaModels: { image: 'remote-image' },
      modelCatalog: { image: [{ id: 'remote-image', name: 'Remote Dreamshaper' }] },
    });

    const view = rtl.render(React.createElement(ModelSelectorModal, {
      visible: true,
      initialTab: 'image',
      onClose: () => {},
      onSelectModel: () => {},
      onUnloadModel: () => {},
      isLoading: false,
    }));
    // The rows fill in a frame after the sheet opens.
    const localRow = await view.findByRole('button', { name: 'Local Image' });
    const remoteRow = view.getByRole('button', { name: 'Remote Dreamshaper' });

    rtl.fireEvent.press(localRow);
    await rtl.waitFor(() => expect(view.getByRole('button', { name: 'Local Image' }).props.accessibilityState.selected).toBe(true));
    expect(view.getByRole('button', { name: 'Remote Dreamshaper' }).props.accessibilityState.selected).toBe(false);
    expect(view.getByTestId('currently-loaded-image-model-name')).toHaveTextContent('Local Image');

    rtl.fireEvent.press(remoteRow);
    await rtl.waitFor(() => expect(view.getByRole('button', { name: 'Remote Dreamshaper' }).props.accessibilityState.selected).toBe(true));
    expect(view.getByRole('button', { name: 'Local Image' }).props.accessibilityState.selected).toBe(false);
    expect(view.getByTestId('currently-loaded-image-model-name')).toHaveTextContent('Remote Dreamshaper');

    rtl.fireEvent.press(localRow);
    await rtl.waitFor(() => expect(view.getByRole('button', { name: 'Local Image' }).props.accessibilityState.selected).toBe(true));
    expect(view.getByRole('button', { name: 'Remote Dreamshaper' }).props.accessibilityState.selected).toBe(false);
    expect(view.getByTestId('currently-loaded-image-model-name')).toHaveTextContent('Local Image');
    view.unmount();
  });
});
