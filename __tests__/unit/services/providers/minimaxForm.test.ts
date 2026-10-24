import React from 'react';
import { act, create } from 'react-test-renderer';
import { useRemoteServerForm } from '../../../../src/components/RemoteServerEditor/useRemoteServerForm';
import { remoteServerManager } from '../../../../src/services/remoteServerManager';
import type { RemoteServer } from '../../../../src/types';

jest.mock('../../../../src/services/remoteServerManager', () => ({
  remoteServerManager: {
    getApiKey: jest.fn(async () => null),
    testConnectionByEndpoint: jest.fn(async () => ({
      success: true, models: [{ id: 'MiniMax-M3' }],
    })),
  },
}));
jest.mock('../../../../src/stores', () => ({ useRemoteServerStore: {} }));
jest.mock('../../../../src/services/httpClient', () => ({ isPrivateNetworkEndpoint: () => false }));
jest.mock('../../../../src/components/CustomAlert', () => ({ initialAlertState: {}, showAlert: jest.fn() }));

// Hooks are mounted so edits between renders exercise callback capture and updater ordering.
describe('MiniMax editor defaults', () => {
  it.each(['', 'MiniMax-M2.7', 'custom-model'])('preserves explicit selection %s when testing', async selection => {
    let form!: ReturnType<typeof useRemoteServerForm>;
    function Harness() {
      form = useRemoteServerForm({ visible: true, onClose: jest.fn() });
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await act(async () => {
      form.setName('MiniMax');
      form.setEndpoint('https://api.minimax.io/v1');
    });
    await act(async () => { form.setTextModelId(selection); });
    await act(async () => { await form.handleTestConnection(); });
    expect(form.textModelId).toBe(selection || 'MiniMax-M3.1-Flash');
    expect(form.providerType).toBe('minimax');
    expect(remoteServerManager.testConnectionByEndpoint).toHaveBeenCalled();
    await act(async () => { renderer.unmount(); });
  });

  it('preserves an existing provider type on a custom endpoint', async () => {
    const server = {
      id: 'saved', name: 'Custom', endpoint: 'https://custom.example/anthropic',
      providerType: 'anthropic', mediaModels: { text: 'saved-model' },
    } as RemoteServer;
    let form!: ReturnType<typeof useRemoteServerForm>;
    function Harness() {
      form = useRemoteServerForm({ server, visible: true, onClose: jest.fn() });
      return null;
    }
    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await act(async () => { await form.handleTestConnection(); });
    expect(form.providerType).toBe('anthropic');
    expect(form.textModelId).toBe('saved-model');
    await act(async () => { renderer.unmount(); });
  });
});
