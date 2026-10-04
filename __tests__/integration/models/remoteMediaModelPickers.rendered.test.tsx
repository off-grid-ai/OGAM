import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

let applicationFixture:
  | import('../../harness/mobileApplicationFixture').MobileApplicationFixture
  | undefined;

afterEach(async () => {
  await applicationFixture?.dispose();
  applicationFixture = undefined;
});

function pressByWalkingUp(node: unknown): void {
  type N = { props?: Record<string, unknown>; parent?: N | null } | null;
  let current = node as N;
  for (let depth = 0; current && depth < 12; depth += 1) {
    if (typeof current.props?.onPress === 'function') {
      (current.props.onPress as () => void)();
      return;
    }
    current = current.parent ?? null;
  }
  throw new Error('No press handler exists above this rendered node.');
}

async function setup() {
  const boundary = installNativeBoundary({ fs: true });
  const React = require('react');
  const rtl = requireRTL();
  const AsyncStorage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  const { startMobileApplicationFixture } =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  applicationFixture = await startMobileApplicationFixture();
  const {
    remoteServerManager,
  } = require('../../../src/services/remoteServerManager');
  const {
    useRemoteServerStore,
  } = require('../../../src/stores/remoteServerStore');
  const {
    useModelFailureStore,
  } = require('../../../src/stores/modelFailureStore');
  useModelFailureStore.getState().clear();
  await remoteServerManager.clearAllServers();
  return {
    boundary,
    React,
    rtl,
    remoteServerManager,
    useRemoteServerStore,
  };
}

describe('remote media model pickers', () => {
  async function addGateway(remoteServerManager: any): Promise<string> {
    const serverId = (
      await remoteServerManager.addServer({
        name: 'Studio Mac',
        endpoint: 'http://192.168.1.50:7878', // NOSONAR - private LAN test fixture
        provider: 'openai-compatible',
        selections: {
          transcription: '/models/whisper-base.bin',
          voice: '/models/kokoro.pte',
        },
        catalog: {
          transcription: [
            { id: '/models/whisper-base.bin', name: 'Whisper Base' },
            { id: '/models/whisper-large-v3.bin', name: 'Whisper Large v3' },
          ],
          voice: [
            { id: '/models/kokoro.pte', name: 'Kokoro' },
            { id: '/models/orpheus.pte', name: 'Orpheus' },
          ],
        },
      })
    ).id;
    const {
      refreshMobileModelServices,
    } = require('../../../src/services/modelServices');
    await refreshMobileModelServices();
    return serverId;
  }

  it('changes the active transcription model and shows human names', async () => {
    const h = await setup();
    const serverId = await addGateway(h.remoteServerManager);
    const {
      RemoteModelOptionsSection,
    } = require('../../../src/components/models/RemoteModelOptionsSection');
    const ui = h.rtl.render(
      h.React.createElement(RemoteModelOptionsSection, {
        category: 'transcription',
      }),
    );

    expect(ui.getByText('Whisper Large v3')).toBeTruthy();
    expect(ui.queryByText('/models/whisper-large-v3.bin')).toBeNull();
    expect(
      applicationFixture!.application.models.remoteModelRoute(
        serverId,
        '/models/whisper-large-v3.bin',
        'transcription',
      ),
    ).not.toBeNull();
    pressByWalkingUp(
      ui.getByTestId(
        `remote-transcription-model-${serverId}:/models/whisper-large-v3.bin`,
      ),
    );

    await h.rtl.waitFor(() =>
      expect(
        h.useRemoteServerStore.getState().getServerById(serverId)?.selections
          ?.transcription,
      ).toBe('/models/whisper-large-v3.bin'),
    );
    ui.unmount();
  });

  it('shows the remote transcription privacy boundary even when remote choices are hidden', async () => {
    const h = await setup();
    const serverId = await addGateway(h.remoteServerManager);
    const {
      selectRemoteMobileModel,
    } = require('../../../src/services/modelServices');
    const {
      TranscriptionModelsTab,
    } = require('../../../src/screens/ModelsScreen/TranscriptionModelsTab');
    await selectRemoteMobileModel(
      serverId,
      'transcription',
      '/models/whisper-base.bin',
    );

    const ui = h.rtl.render(
      h.React.createElement(TranscriptionModelsTab, {
        showRemoteModels: false,
      }),
    );

    await h.rtl.waitFor(() => {
      expect(
        ui.getByText('Whisper Base runs on your active remote server'),
      ).toBeTruthy();
    });
    expect(ui.queryByText(/audio is never sent anywhere/)).toBeNull();
    ui.unmount();
  });

  it('shows a canonical transcription failure when tab disk reconciliation fails', async () => {
    const h = await setup();
    const {
      TranscriptionModelsTab,
    } = require('../../../src/screens/ModelsScreen/TranscriptionModelsTab');
    (h.boundary.fs!.module.exists as jest.Mock).mockResolvedValueOnce(true);
    (h.boundary.fs!.module.readDir as jest.Mock).mockRejectedValueOnce(
      new Error('Model storage is unavailable'),
    );

    const ui = h.rtl.render(
      h.React.createElement(TranscriptionModelsTab, {
        showRemoteModels: false,
      }),
    );

    await h.rtl.waitFor(() => {
      expect(ui.getByTestId('model-failure-stt')).toBeTruthy();
      expect(
        ui.getByText('Off Grid AI could not update your transcription models.'),
      ).toBeTruthy();
    });
    ui.unmount();
  });

  it('changes the active voice model without changing the raw server model ID', async () => {
    const h = await setup();
    const { decodeModelRouteId } = require('@offgrid/models');
    const {
      readMobileModelSelection,
    } = require('../../../src/services/modelServices/modelSelectionProjection');
    const {
      RemoteModelOptionsSection,
    } = require('../../../src/components/models/RemoteModelOptionsSection');
    const serverId = await addGateway(h.remoteServerManager);
    const textServerId = (
      await h.remoteServerManager.addServer({
        name: 'Text Mac',
        endpoint: 'http://192.168.1.51:7878', // NOSONAR - private LAN test fixture
        provider: 'openai-compatible',
        selections: { text: 'text-model' },
        catalog: { text: [{ id: 'text-model', name: 'Text Model' }] },
      })
    ).id;
    h.useRemoteServerStore.getState().setDiscoveredModels(textServerId, [
      {
        id: 'text-model',
        name: 'Text Model',
        serverId: textServerId,
        capabilities: {
          supportsVision: false,
          supportsToolCalling: true,
          supportsThinking: false,
        },
        lastUpdated: new Date(0).toISOString(),
      },
    ]);
    const {
      refreshMobileModelServices,
    } = require('../../../src/services/modelServices');
    await refreshMobileModelServices();
    await h.remoteServerManager.setActiveRemoteTextModel(
      textServerId,
      'text-model',
    );
    const ui = h.rtl.render(
      h.React.createElement(RemoteModelOptionsSection, { category: 'voice' }),
    );

    pressByWalkingUp(
      ui.getByTestId(`remote-voice-model-${serverId}:/models/orpheus.pte`),
    );

    await h.rtl.waitFor(() => {
      const state = h.useRemoteServerStore.getState();
      // The text route still points at the text server; the voice route at the gateway.
      expect(
        decodeModelRouteId(readMobileModelSelection('text') ?? '')?.serverId,
      ).toBe(textServerId);
      expect(
        decodeModelRouteId(readMobileModelSelection('voice') ?? '')?.serverId,
      ).toBe(serverId);
      expect(
        state.servers.find(
          (server: { id: string; selections?: { voice?: string } }) =>
            server.id === serverId,
        )?.selections?.voice,
      ).toBe('/models/orpheus.pte');
    });
    expect(ui.getByText('Orpheus')).toBeTruthy();
    ui.unmount();
  });

  it('shows the canonical catalog name when Desktop reports an active file alias', () => {
    installNativeBoundary();
    const React = require('react');
    const rtl = requireRTL();
    const {
      RemoteModelField,
    } = require('../../../src/components/RemoteServerEditor/RemoteModelField');
    const ui = rtl.render(
      React.createElement(RemoteModelField, {
        label: 'Text model',
        value: 'Qwen3.5-2B-Q4_K_M.gguf',
        displayValue: 'Qwen 3.5 2B',
        options: [
          {
            id: 'unsloth/Qwen3.5-2B-GGUF',
            name: 'Qwen 3.5 2B',
            activeAliases: ['Qwen3.5-2B-Q4_K_M.gguf'],
          },
        ],
        onChange: jest.fn(),
        placeholder: 'Model',
        testID: 'canonical-model',
      }),
    );

    expect(ui.getByText('Qwen 3.5 2B')).toBeTruthy();
    expect(ui.queryByText('Qwen3.5-2B-Q4_K_M.gguf')).toBeNull();
  });
});
