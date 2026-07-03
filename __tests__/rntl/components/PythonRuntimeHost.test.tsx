/**
 * PythonRuntimeHost Component Tests
 *
 * The hidden WebView must stay unmounted until an execution is requested,
 * register its bridge with the service while mounted, and route messages.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

let mockWebViewProps: any = null;
jest.mock('react-native-webview', () => {
  const ReactActual = require('react');
  const { View } = require('react-native');
  return {
    WebView: (props: any) => {
      mockWebViewProps = props;
      return ReactActual.createElement(View, { testID: props.testID });
    },
  };
});

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { PythonRuntimeHost } from '../../../src/components/PythonRuntimeHost';
import { usePythonRuntimeStore } from '../../../src/stores/pythonRuntimeStore';
import { pythonRuntimeService } from '../../../src/services/python/pythonRuntimeService';

function setStore(state: Partial<ReturnType<typeof usePythonRuntimeStore.getState>>): void {
  usePythonRuntimeStore.setState({
    status: 'not_installed',
    downloadProgress: 0,
    errorMessage: null,
    executorRequested: false,
    serverOrigin: null,
    ...state,
  });
}

describe('PythonRuntimeHost', () => {
  beforeEach(() => {
    mockWebViewProps = null;
    setStore({});
    jest.restoreAllMocks();
  });

  it('renders nothing until an execution has been requested', () => {
    setStore({ status: 'installed', serverOrigin: 'http://localhost:8899' });
    const { queryByTestId } = render(<PythonRuntimeHost />);
    expect(queryByTestId('python-runtime-host')).toBeNull();
  });

  it('renders nothing when the runtime is not installed', () => {
    setStore({ executorRequested: true, serverOrigin: 'http://localhost:8899' });
    const { queryByTestId } = render(<PythonRuntimeHost />);
    expect(queryByTestId('python-runtime-host')).toBeNull();
  });

  it('mounts the WebView pointed at the local server once requested', () => {
    setStore({ status: 'installed', executorRequested: true, serverOrigin: 'http://localhost:8899' });
    const { getByTestId } = render(<PythonRuntimeHost />);
    expect(getByTestId('python-runtime-webview')).toBeTruthy();
    expect(mockWebViewProps.source).toEqual({ uri: 'http://localhost:8899/index.html' });
  });

  it('registers an executor with the service while mounted and unregisters on unmount', () => {
    const registerSpy = jest.spyOn(pythonRuntimeService, 'registerExecutor');
    const unregisterSpy = jest.spyOn(pythonRuntimeService, 'unregisterExecutor');
    setStore({ status: 'installed', executorRequested: true, serverOrigin: 'http://localhost:8899' });

    const { unmount } = render(<PythonRuntimeHost />);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy.mock.calls[0][0]).toHaveProperty('inject');
    expect(registerSpy.mock.calls[0][0]).toHaveProperty('reload');

    unmount();
    expect(unregisterSpy).toHaveBeenCalledTimes(1);
  });

  it('routes WebView messages to the service with the source URL for origin validation', () => {
    const handleSpy = jest.spyOn(pythonRuntimeService, 'handleWebViewMessage').mockImplementation(() => { });
    setStore({ status: 'installed', executorRequested: true, serverOrigin: 'http://localhost:8899' });

    render(<PythonRuntimeHost />);
    mockWebViewProps.onMessage({ nativeEvent: { data: '{"type":"ready"}', url: 'http://localhost:8899/index.html' } });

    expect(handleSpy).toHaveBeenCalledWith('{"type":"ready"}', 'http://localhost:8899/index.html');
  });

  it('locks originWhitelist to the server origin and rejects off-origin navigation', () => {
    setStore({ status: 'installed', executorRequested: true, serverOrigin: 'http://localhost:8899' });
    render(<PythonRuntimeHost />);

    expect(mockWebViewProps.originWhitelist).toEqual(['http://localhost:8899']);
    // Loopback page load is allowed; an exfiltration navigation is rejected.
    expect(mockWebViewProps.onShouldStartLoadWithRequest({ url: 'http://localhost:8899/index.html' })).toBe(true);
    expect(mockWebViewProps.onShouldStartLoadWithRequest({ url: 'https://attacker.example/?d=secret' })).toBe(false);
  });

  it('reports a renderer process kill to the service so it can rebuild', () => {
    const crashSpy = jest.spyOn(pythonRuntimeService, 'notifyExecutorCrashed').mockImplementation(() => { });
    setStore({ status: 'installed', executorRequested: true, serverOrigin: 'http://localhost:8899' });
    render(<PythonRuntimeHost />);

    mockWebViewProps.onContentProcessDidTerminate();
    expect(crashSpy).toHaveBeenCalledTimes(1);

    expect(mockWebViewProps.onRenderProcessGone()).toBe(true);
    expect(crashSpy).toHaveBeenCalledTimes(2);
  });
});
