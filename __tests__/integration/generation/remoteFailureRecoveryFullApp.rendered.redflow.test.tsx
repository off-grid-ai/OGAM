/** P2 #146-148 — remote failure recovery and return to a local active model. */
import { renderMainApp, sendChatMessage } from '../../harness/appJourney';
import {
  installRemoteDiscoveryBoundary,
  openRemoteChatThroughApp,
  openTextModelPickerThroughHome,
} from '../../harness/fullAppRemoteJourney';

type FailureKind = 'timeout' | 'malformed';

function installRemoteFailureBoundary(sequence: FailureKind[]): void {
  class FailureXHR {
    responseText = '';
    readyState = 0;
    status = 0;
    timeout = 0;
    onprogress: null | (() => void) = null;
    onreadystatechange: null | (() => void) = null;
    onerror: null | (() => void) = null;
    ontimeout: null | (() => void) = null;

    open(): void {
      this.readyState = 1;
    }
    setRequestHeader(): void {}
    abort(): void {}
    send(): void {
      const kind = sequence.shift();
      if (!kind) throw new Error('No remote failure scripted');
      setTimeout(() => {
        if (kind === 'timeout') {
          this.ontimeout?.();
          return;
        }
        this.responseText = 'data: {not-valid-json}\n\n';
        this.status = 200;
        this.readyState = 4;
        this.onreadystatechange?.();
      }, 0);
    }
  }
  globalThis.XMLHttpRequest = FailureXHR as unknown as typeof XMLHttpRequest;
}

const originalFetch = globalThis.fetch;
const originalXMLHttpRequest = globalThis.XMLHttpRequest;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.XMLHttpRequest = originalXMLHttpRequest;
});

describe('P2 full-App remote failure recovery', () => {
  it('surfaces timeout and malformed-stream outcomes, then activates a local model', async () => {
    installRemoteDiscoveryBoundary();
    const app = await renderMainApp();
    await openRemoteChatThroughApp(app.rtl, app.view);
    // The malformed empty turn triggers the production no-tools retry once.
    installRemoteFailureBoundary(['timeout', 'malformed', 'malformed']);

    sendChatMessage(app.rtl, app.view, 'Exercise the timeout path');
    await app.rtl.waitFor(
      () => {
        expect(app.view.getByText('Request timeout')).toBeTruthy();
        expect(app.view.getByText('Generation Error')).toBeTruthy();
        expect(app.view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );
    app.rtl.fireEvent.press(app.view.getByText('OK'));

    sendChatMessage(app.rtl, app.view, 'Exercise malformed remote data');
    await app.rtl.waitFor(
      () => {
        expect(app.view.getByText(/No response/)).toBeTruthy();
        expect(app.view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );

    app.rtl.fireEvent.press(app.view.getByTestId('chat-back-button'));
    await app.rtl.waitFor(() =>
      expect(app.view.getByTestId('home-screen')).toBeTruthy(),
    );
    await openTextModelPickerThroughHome(app.rtl, app.view);
    const localModel = await app.rtl.waitFor(() =>
      app.view.getByTestId('model-item'),
    );
    app.rtl.fireEvent.press(localModel);
    await app.rtl.waitFor(() => {
      expect(app.view.getByTestId('new-chat-button')).toBeTruthy();
    });
    await openTextModelPickerThroughHome(app.rtl, app.view);
    const selectedLocal = await app.rtl.waitFor(() =>
      app.view.getByTestId('model-item'),
    );
    expect(
      app.rtl.within(selectedLocal).UNSAFE_getByProps({ name: 'check' }),
    ).toBeTruthy();
    app.view.unmount();
  }, 30000);
});
