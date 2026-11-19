// The translation preview's bundle: the app's own Metro config, built for the web with React Native Web.
// Native modules (model engines, files, keychain, camera...) are stood in for by preview/native-stub.js, so
// the real screens render in a browser with no data. `npm run build:preview` writes preview/dist/.
const path = require('node:path');
const appConfig = require('../metro.config.js');

const root = path.resolve(__dirname, '..');
const stub = path.resolve(__dirname, 'native-stub.js');
// Holds a Pro licence, so the Pro screens show in a release build (see keychain.js).
const keychain = path.resolve(__dirname, 'keychain.js');
// The licence server client, always offline (see keygen-offline.js).
const keygenOffline = path.resolve(__dirname, 'keygen-offline.js');
// The browser's <video>, so guide clips play (see video.js).
const video = path.resolve(__dirname, 'video.js');

// Libraries with no web build. Anything else that ships a web build (React Native Web, Navigation,
// Reanimated, Gesture Handler, Safe Area, Screens, SVG, Async Storage) runs as it is.
const NATIVE_ONLY = [
  'llama.rn',
  'whisper.rn',
  'react-native-executorch',
  'react-native-executorch-bare-resource-fetcher',
  '@op-engineering/op-sqlite',
  '@dr.pogodin/react-native-fs',
  'react-native-fs',
  'react-native-blob-util',
  'react-native-zip-archive',
  'react-native-device-info',
  'react-native-audio-api',
  'react-native-video-player',
  'react-native-vision-camera',
  'react-native-webview',
  'react-native-zeroconf',
  'react-native-tcp-socket',
  'react-native-calendar-events',
  'react-native-haptic-feedback',
  'react-native-in-app-review',
  'react-native-inappbrowser-reborn',
  'react-native-image-picker',
  'react-native-edge-to-edge',
  'react-native-keyboard-controller',
  'react-native-get-random-values',
  '@react-native-documents/picker',
  '@react-native-documents/viewer',
  '@react-native-voice/voice',
  '@kesha-antonov/react-native-background-downloader',
  'posthog-react-native',
];
const isNativeOnly = name =>
  NATIVE_ONLY.some(n => name === n || name.startsWith(`${n}/`));

const appResolve = appConfig.resolver.resolveRequest;

module.exports = {
  ...appConfig,
  projectRoot: root,
  resolver: {
    ...appConfig.resolver,
    platforms: ['web', 'ios', 'android', 'native'],
    resolveRequest: (appContext, moduleName, platform) => {
      // A web bundle takes a library's web file (AsyncStorage.ts), never its .native one.
      const context = { ...appContext, preferNativePlatform: false };
      if (moduleName === 'react-native')
        return context.resolveRequest(context, 'react-native-web', platform);
      if (moduleName === 'react-native-keychain')
        return { type: 'sourceFile', filePath: keychain };
      if (moduleName === 'react-native-video')
        return { type: 'sourceFile', filePath: video };
      if (/(^|\/)keygenClient$/.test(moduleName))
        return { type: 'sourceFile', filePath: keygenOffline };
      if (isNativeOnly(moduleName))
        return { type: 'sourceFile', filePath: stub };
      // Images: require('x.png') registers with React Native's asset registry. React Native Web reads
      // its own, so point the registry there and the pictures draw.
      if (moduleName.endsWith('Libraries/Image/AssetRegistry'))
        return context.resolveRequest(
          context,
          'react-native-web/dist/cjs/modules/AssetRegistry',
          platform,
        );
      // React Native internals (Libraries/..., codegen native components) have no web build.
      if (moduleName.startsWith('react-native/'))
        return { type: 'sourceFile', filePath: stub };
      return appResolve(context, moduleName, platform);
    },
    extraNodeModules: {
      ...appConfig.resolver.extraNodeModules,
      'react-native-fs': stub,
    },
  },
};
