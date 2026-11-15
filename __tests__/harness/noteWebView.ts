/**
 * The phone's WebView, as a device boundary: the real Notes editor page (@offgrid/notes-editor's
 * webview-html, the bytes the app ships) running in jsdom. The app's messages go in through
 * injectJavaScript, as on a phone; the page's go out through window.ReactNativeWebView.postMessage
 * to the WebView's onMessage, a tick later, as the native bridge delivers them.
 *
 * jsdom has no layout, so the page's few layout reads (caret rects, scrolling into view) answer
 * zero, as a page that is not on screen would, and no media query matches.
 *
 * Use: jest.mock('react-native-webview', () => require('<path>/harness/noteWebView').webViewModule());
 */
/** The page's TipTap editor (the app has no TipTap types: the page is a bundle). */
type Editor = { view: any; state: any };

/** jsdom's window and nodes (the app's TypeScript has no DOM types). */
type Dom = any;

export interface NotePage {
  window: Dom;
  document: Dom;
  /** The live editor the page mounted. */
  editor(): Editor;
  /** The page's text, as a person reads it. */
  text(): string;
  /** Type `text` at the caret, one key at a time (input rules and `[[` completion run; `\n` is Enter). */
  type(text: string): void;
  /** A tap on `element` (a link, a menu row). */
  tap(element: Dom): void;
}

// On the global: the boundary resets the module registry, so the screen's copy of this module and
// the test's are not the same one.
const pages: NotePage[] = ((globalThis as any).__notePages ??= []);

/** The editor pages open now, oldest first; the last is the one on screen. */
export function notePages(): NotePage[] {
  return pages;
}

/** The page on screen. */
export function notePage(): NotePage {
  const page = pages[pages.length - 1];
  if (!page) throw new Error('no note page is open');
  return page;
}

function openPage(html: string, url: string, post: (data: string) => void): NotePage {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window: Dom) {
      window.ReactNativeWebView = { postMessage: (data: string) => setTimeout(() => post(data), 0) };
      const none = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} });
      window.Range.prototype.getClientRects = () => [];
      window.Range.prototype.getBoundingClientRect = none;
      window.Element.prototype.scrollIntoView = () => undefined;
      window.document.elementFromPoint = () => null;
      window.matchMedia = (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
    },
  });
  const window: Dom = dom.window;
  const editor = (): Editor => {
    const el: { editor?: Editor } | null = window.document.querySelector('.ProseMirror');
    if (!el?.editor) throw new Error('the page mounted no editor');
    return el.editor;
  };
  return {
    window,
    document: window.document,
    editor,
    text: () => window.document.querySelector('.ProseMirror')?.textContent ?? '',
    type(text) {
      const { view } = editor();
      for (const ch of text) {
        if (ch === '\n') {
          const enter = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
          view.someProp('handleKeyDown', (f: any) => f(view, enter));
          continue;
        }
        const { from, to } = view.state.selection;
        if (!view.someProp('handleTextInput', (f: any) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to))))
          view.dispatch(view.state.tr.insertText(ch, from, to));
      }
    },
    tap(element) {
      const { view } = editor();
      // Text (a link in a line) goes through the editor's click; the page's buttons (the contents,
      // a menu) take the touch as DOM events, as a WebView delivers it.
      if (view.dom.contains(element) && !element.closest('button')) {
        const event = new window.MouseEvent('click', { bubbles: true });
        Object.defineProperty(event, 'target', { value: element });
        view.someProp('handleClick', (f: any) => f(view, view.posAtDOM(element, 0), event));
        return;
      }
      element.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    },
  };
}

/** react-native-webview with the page in jsdom behind it. */
export function webViewModule() {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native');
  const WebView = React.forwardRef(function WebView(props: any, ref) {
    const latest = React.useRef(props);
    latest.current = props;
    const [page] = React.useState(() =>
      openPage(props.source.html, props.source.baseUrl ?? 'about:blank', data =>
        latest.current.onMessage?.({ nativeEvent: { data } }),
      ),
    );
    React.useEffect(() => {
      pages.push(page);
      return () => {
        pages.splice(pages.indexOf(page), 1);
        page.window.close();
      };
    }, [page]);
    React.useImperativeHandle(ref, () => ({
      injectJavaScript: (script: string) => page.window.eval(script),
      requestFocus: () => undefined,
    }));
    return React.createElement(View, { testID: props.testID, style: props.style });
  });
  return { __esModule: true, default: WebView, WebView };
}
