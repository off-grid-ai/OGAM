// The stand-in for a native module in the translation preview (the app's screens in a browser). UI only:
// any property is another stand-in, a call answers a stand-in, a component draws only its children. So a screen that
// reads DeviceInfo or a model engine still draws its text, which is all the preview is for.
// A stand-in component draws its children: providers (KeyboardProvider) wrap the whole app.
function component(props) {
  return props && props.children !== undefined ? props.children : null;
}

const REACT_STATICS = new Set([
  '$$typeof',
  'contextType',
  'contextTypes',
  'childContextTypes',
  'defaultProps',
  'displayName',
  'getDerivedStateFromProps',
  'getDerivedStateFromError',
  'propTypes',
  'prototype',
  'render',
  'compare',
  'type',
]);

function make(asComponent) {
  return new Proxy(asComponent ? component : function stub() {}, {
    get(_target, property) {
      if (property === '__esModule') return true;
      // React reads these statics off a component; it has none. Any other property is a module member
      // (RNFS.exists, DeviceInfo.getTotalMemory), so a default export works as both.
      if (asComponent && REACT_STATICS.has(property)) return undefined;
      if (property === 'default') return make(true);
      if (property === 'then') return undefined; // not a promise: `await stub` is the stub itself
      if (property === Symbol.toPrimitive) return () => '';
      if (property === Symbol.iterator) return function* empty() {};
      if (property === 'length') return 0;
      if (property === 'prototype') return {};
      // Components are capitalised (Video, Camera, WebView): they render nothing.
      return make(typeof property === 'string' && /^[A-Z]/.test(property));
    },
    apply(_target, _this, args) {
      return asComponent ? component(args[0]) : make(false);
    },
    construct() {
      return make(false);
    },
  });
}

module.exports = make(false);
