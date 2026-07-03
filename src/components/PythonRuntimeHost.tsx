/**
 * PythonRuntimeHost
 *
 * Invisible WebView that hosts the Pyodide interpreter for the run_python
 * tool. Mounted once at the app root; renders nothing until the runtime is
 * installed and an execution has been requested (pythonRuntimeService sets
 * executorRequested on first use), then stays warm so interpreter state and
 * loaded packages persist across tool calls.
 */

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewProps } from 'react-native-webview';
import { pythonRuntimeService } from '../services/python/pythonRuntimeService';
import { usePythonRuntimeStore } from '../stores/pythonRuntimeStore';
import { PYTHON_PAGE_FILE } from '../services/python/pyodideManifest';

interface WebViewHandle {
  injectJavaScript: (js: string) => void;
}

// react-native-webview's class component types don't resolve under React 19's
// JSX checker (props collapse to never) — re-type it with the props we use.
const RNWebView = WebView as unknown as React.FC<
  WebViewProps & { ref?: React.Ref<WebViewHandle> }
>;

export const PythonRuntimeHost: React.FC = () => {
  const status = usePythonRuntimeStore((s) => s.status);
  const executorRequested = usePythonRuntimeStore((s) => s.executorRequested);
  const serverOrigin = usePythonRuntimeStore((s) => s.serverOrigin);
  const webViewRef = useRef<WebViewHandle>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const active = executorRequested && status === 'installed' && !!serverOrigin;

  useEffect(() => {
    if (!active) return;
    pythonRuntimeService.registerExecutor({
      inject: (js) => webViewRef.current?.injectJavaScript(js),
      reload: () => setReloadKey((k) => k + 1),
    });
    return () => pythonRuntimeService.unregisterExecutor();
  }, [active]);

  if (!active || !serverOrigin) return null;

  // Model-written (and thus prompt-injectable) Python can reach the DOM via
  // Pyodide's `import js`. Confine the WebView to the exact loopback origin so
  // that code cannot navigate the page to an attacker URL and exfiltrate the
  // injected code string or forge tool-result messages back into the chat.
  const allowedOrigin = serverOrigin;
  const isAllowedUrl = (url: string): boolean =>
    url === `${allowedOrigin}/${PYTHON_PAGE_FILE}` ||
    url === allowedOrigin ||
    url.startsWith(`${allowedOrigin}/`);

  return (
    <View style={styles.hidden} pointerEvents="none" testID="python-runtime-host">
      <RNWebView
        key={reloadKey}
        ref={webViewRef}
        source={{ uri: `${allowedOrigin}/${PYTHON_PAGE_FILE}` }}
        onMessage={(event: { nativeEvent: { data: string; url?: string } }) =>
          pythonRuntimeService.handleWebViewMessage(event.nativeEvent.data, event.nativeEvent.url)
        }
        originWhitelist={[allowedOrigin]}
        onShouldStartLoadWithRequest={(req: { url: string }) => isAllowedUrl(req.url)}
        // The interpreter holds a large WASM+numpy+pandas heap in an off-screen
        // WebView — a prime target for OS memory reclamation. Surface a renderer
        // process kill immediately so the service can rebuild, instead of leaving
        // the next run to hit a 60s boot timeout.
        onContentProcessDidTerminate={() => pythonRuntimeService.notifyExecutorCrashed('WebView content process terminated')}
        onRenderProcessGone={() => {
          pythonRuntimeService.notifyExecutorCrashed('WebView render process gone');
          return true;
        }}
        javaScriptEnabled
        allowsBackForwardNavigationGestures={false}
        setSupportMultipleWindows={false}
        testID="python-runtime-webview"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
    overflow: 'hidden',
  },
});
