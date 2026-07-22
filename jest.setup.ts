/**
 * Jest Setup File
 *
 * Configures global mocks and test utilities for the Off Grid test suite.
 * This file runs after the test framework is installed in the environment.
 */

// Import extended matchers - path varies by version
// v12.4+ has built-in matchers, earlier versions use separate import
try {
  require('@testing-library/react-native/extend-expect');
} catch {
  // Built-in matchers in v12.4+, or no matchers needed for basic tests
}

// Raise RNTL's async-util timeout (waitFor/findBy) from the 1s default to 5s. Under heavy
// parallelism (the pre-push --findRelatedTests run fans hundreds of Message-importing
// suites across all workers), the 1s default starves — a genuinely-passing waitFor poll
// doesn't get scheduled in time and flakes. 5s is load-tolerant yet well under the 30s
// jest testTimeout, so passing tests stay fast and only starved ones get grace. Removes a
// whole class of load-dependent flakiness without changing any assertion.
try {
  require('@testing-library/react-native').configure({ asyncUtilTimeout: 5000 });
} catch {
  // RNTL not present in a given suite's module graph — nothing to configure.
}

const shouldPrintJestConsole = process.env.DEBUG_JEST_CONSOLE === '1';

// react-native-keyboard-controller ships a jest mock; without it, any test that
// renders App or ChatScreen pulls in its native module and crashes.
jest.mock('react-native-keyboard-controller', () =>
  require('react-native-keyboard-controller/jest'),
);

// react-native-edge-to-edge drives the system bars natively; stub its components
// so tests rendering App don't reach the native module.
jest.mock('react-native-edge-to-edge', () => ({
  SystemBars: () => null,
  StatusBar: () => null,
  NavigationBar: () => null,
}));

// Native splash is outside the JS product; keep the real App boot/navigation path mounted in Jest.
jest.mock('react-native-bootsplash', () => ({ hide: jest.fn(async () => {}) }), { virtual: true });

// ============================================================================
// AsyncStorage Mock
// ============================================================================
const mockStorage: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn((key: string, value: string) => {
    mockStorage[key] = value;
    return Promise.resolve();
  }),
  getItem: jest.fn((key: string) => {
    return Promise.resolve(mockStorage[key] || null);
  }),
  removeItem: jest.fn((key: string) => {
    delete mockStorage[key];
    return Promise.resolve();
  }),
  multiSet: jest.fn((pairs: [string, string][]) => {
    pairs.forEach(([key, value]) => {
      mockStorage[key] = value;
    });
    return Promise.resolve();
  }),
  multiGet: jest.fn((keys: string[]) => {
    return Promise.resolve(keys.map(key => [key, mockStorage[key] || null]));
  }),
  multiRemove: jest.fn((keys: string[]) => {
    keys.forEach(key => delete mockStorage[key]);
    return Promise.resolve();
  }),
  clear: jest.fn(() => {
    Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
    return Promise.resolve();
  }),
  getAllKeys: jest.fn(() => {
    return Promise.resolve(Object.keys(mockStorage));
  }),
}));

// Helper to clear storage between tests
export const clearMockStorage = () => {
  Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
};

// ============================================================================
// React Native Mocks - Partial mocks to avoid full module loading issues
// ============================================================================
// Note: We don't mock the entire 'react-native' module as it causes issues
// with internal RN module loading (DevMenu, TurboModules, etc.)
// Instead, we mock specific native modules that need it.

// ============================================================================
// Navigation Mocks
// ============================================================================
// Direct-screen tests keep navigation as lightweight plumbing. Real-App journeys
// explicitly unmock this module before importing App so route behavior stays real
// whenever navigation is part of the user-visible behavior under test.
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: jest.fn(),
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    useRoute: () => ({
      params: {},
    }),
    useFocusEffect: jest.fn(),
    useIsFocused: () => true,
  };
});

// ============================================================================
// Native Module Mocks
// ============================================================================

// llama.rn mock - use virtual mock since native module may not resolve
jest.mock('llama.rn', () => ({
  loadLlamaModelInfo: jest.fn(() => Promise.resolve({})),
  initLlama: jest.fn(() => Promise.resolve({
    id: 'test-context-id',
    gpu: false,
    reasonNoGPU: 'Test environment',
    model: {
      nParams: 1000000,
    },
    release: jest.fn(() => Promise.resolve()),
    completion: jest.fn(() => Promise.resolve({
      text: 'Test completion response',
      tokens_predicted: 10,
      tokens_evaluated: 5,
      timings: {
        predicted_per_token_ms: 50,
        predicted_per_second: 20,
      },
    })),
    initMultimodal: jest.fn(() => Promise.resolve(true)),
    getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: false, audio: false })),
    embedding: jest.fn((text: string) => Promise.resolve({
      embedding: new Array(384).fill(0).map((_, i) => Math.sin(i + text.length * 0.1)),
    })),
  })),
  releaseContext: jest.fn(() => Promise.resolve()),
  completion: jest.fn(() => Promise.resolve({
    text: 'Test completion response',
    tokens_predicted: 10,
    tokens_evaluated: 5,
    timings: {
      predicted_per_token_ms: 50,
      predicted_per_second: 20,
    },
  })),
  stopCompletion: jest.fn(() => Promise.resolve()),
  tokenize: jest.fn(() => Promise.resolve({ tokens: [1, 2, 3] })),
  detokenize: jest.fn(() => Promise.resolve({ text: 'detokenized' })),
}), { virtual: true });

// whisper.rn mock - use virtual mock since native module may not resolve
jest.mock('whisper.rn', () => ({
  initWhisper: jest.fn(() => Promise.resolve({
    id: 'test-whisper-id',
  })),
  releaseWhisper: jest.fn(() => Promise.resolve()),
  transcribeFile: jest.fn(() => Promise.resolve({
    result: 'Transcribed text',
    segments: [],
  })),
  transcribeRealtime: jest.fn(() => Promise.resolve()),
  AudioSessionIos: {
    setCategory: jest.fn(() => Promise.resolve()),
    setMode: jest.fn(() => Promise.resolve()),
    setActive: jest.fn(() => Promise.resolve()),
  },
}), { virtual: true });

// RN host-component native-measurement boundary. The RN jest preset stubs measure/measureInWindow as
// no-op jest.fns that never invoke their callback, so any component that anchors UI off a measured node
// (e.g. a dropdown whose open() runs INSIDE the measureInWindow callback) stalls in tests. Faithfully
// invoke the layout callback (x, y, width, height[, pageX, pageY]) so that real UI proceeds — the only
// non-faithful part of the preset's host mock for our flows.
jest.mock('react-native/jest/mockNativeComponent', () => {
  const ReactLocal = require('react');
  let tag = 1;
  return (viewName: string) => {
    const Component = class extends ReactLocal.Component {
      _nativeTag = tag++;
      render() {
        const self = this as unknown as { props: Record<string, unknown> & { children?: unknown } };
        return ReactLocal.createElement(viewName, self.props, self.props.children);
      }
      blur = jest.fn();
      focus = jest.fn();
      measure = (cb?: (...a: number[]) => void) => cb?.(0, 0, 100, 40, 0, 0);
      measureInWindow = (cb?: (...a: number[]) => void) => cb?.(0, 0, 100, 40);
      measureLayout = jest.fn();
      setNativeProps = jest.fn();
    };
    (Component as { displayName?: string }).displayName = viewName === 'RCTView' ? 'View' : viewName;
    return Component;
  };
});

// react-native-audio-api mock
jest.mock('react-native-audio-api', () => ({
  AudioContext: jest.fn().mockImplementation(() => ({
    createBuffer: jest.fn().mockReturnValue({ copyToChannel: jest.fn() }),
    createBufferSource: jest.fn().mockReturnValue({
      connect: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      playbackRate: { value: 1.0 },
      onEnded: null,
      buffer: null,
    }),
    destination: {},
    state: 'suspended',
    resume: jest.fn().mockResolvedValue(undefined),
    suspend: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  AudioManager: {
    setAudioSessionOptions: jest.fn(),
    setAudioSessionActivity: jest.fn().mockResolvedValue(true),
  },
  AudioRecorder: jest.fn().mockImplementation(() => ({
    enableFileOutput: jest.fn().mockReturnValue({ status: 'success', path: '/mock/audio/input.wav' }),
    start: jest.fn().mockReturnValue({ status: 'success', path: '/mock/audio/input.wav' }),
    stop: jest.fn().mockReturnValue({ status: 'success', path: '/mock/audio/input.wav', size: 1024, duration: 1.0 }),
    pause: jest.fn(),
    resume: jest.fn(),
    isRecording: jest.fn().mockReturnValue(false),
    isPaused: jest.fn().mockReturnValue(false),
  })),
  FileFormat: { Wav: 0, Caf: 1, M4A: 2, Flac: 3 },
  FileDirectory: { Document: 0, Cache: 1 },
  BitDepth: { Bit8: 0, Bit16: 1, Bit24: 2, Bit32: 3 },
  IOSAudioQuality: { Min: 0, Low: 1, Medium: 2, High: 3, Max: 4 },
  FlacCompressionLevel: { L0: 0, L5: 5, L8: 8 },
}), { virtual: true });

// @react-native-community/slider mock
jest.mock('@react-native-community/slider', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: View };
});

// react-native-executorch mock
// A voice carries its own assets (embedding + tagger + lexicon) in addition to
// the two shared core .pte models — mirror that so completeness checks
// (_activeVoiceSources) have a realistic full asset set to validate against.
const mockVoiceConfig = {
  id: 'mock_voice',
  voiceSource: 'https://example.test/kokoro/voices/af_heart.bin',
  extra: {
    taggerSource: 'https://example.test/kokoro/tagger.pt',
    lexiconSource: 'https://example.test/kokoro/lexicon.json',
  },
};
jest.mock('react-native-executorch', () => ({
  // Faithful init leaf for the executorch native runtime (a genuine external native boundary):
  // initExecutorch registers the resource fetcher so the runtime is ready to load models through
  // it. With models faked at the fetcher + useTextToSpeech boundary there is nothing further to
  // emulate in-process, so it is a ready-signal (EngineBridge calls it at module import — without
  // this the pro TTS bootstrap throws "initExecutorch is not a function").
  initExecutorch: () => {},
  // useTextToSpeech is the executorch boundary the TTS bridge drives. The streaming/playback is
  // exercised end-to-end by the KokoroTTSBridge suite, which feeds chunks + drives onEnded through
  // the AudioContext itself; here stream() just resolves (the bridge owns the audio pump).
  useTextToSpeech: jest.fn(() => ({
    isReady: true,
    downloadProgress: 1,
    error: null,
    stream: jest.fn(() => Promise.resolve()),
    streamStop: jest.fn(),
  })),
  KOKORO_MEDIUM: {
    modelName: 'kokoro-medium',
    durationPredictorSource: 'https://example.test/kokoro/medium/duration_predictor.pte',
    synthesizerSource: 'https://example.test/kokoro/medium/synthesizer.pte',
  },
  KOKORO_VOICE_AF_HEART: mockVoiceConfig,
  KOKORO_VOICE_AF_RIVER: mockVoiceConfig,
  KOKORO_VOICE_AF_SARAH: mockVoiceConfig,
  KOKORO_VOICE_AM_ADAM: mockVoiceConfig,
  KOKORO_VOICE_AM_MICHAEL: mockVoiceConfig,
  KOKORO_VOICE_AM_SANTA: mockVoiceConfig,
  KOKORO_VOICE_BF_EMMA: mockVoiceConfig,
  KOKORO_VOICE_BM_DANIEL: mockVoiceConfig,
}));

// react-native-executorch-bare-resource-fetcher mock.
// Default: nothing on disk. Tests override listDownloadedModels per case.
jest.mock(
  'react-native-executorch-bare-resource-fetcher',
  () => ({
    BareResourceFetcher: {
      listDownloadedModels: jest.fn(async () => [] as string[]),
      listDownloadedFiles: jest.fn(async () => [] as string[]),
      deleteResources: jest.fn(async () => {}),
      fetch: jest.fn(async () => {}),
    },
  }),
  { virtual: true },
);

// react-native-fs mock
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/documents',
  CachesDirectoryPath: '/mock/caches',
  ExternalDirectoryPath: '/mock/external',
  MainBundlePath: '/mock/bundle',
  downloadFile: jest.fn(() => ({
    jobId: 1,
    promise: Promise.resolve({ statusCode: 200, bytesWritten: 1000 }),
  })),
  stopDownload: jest.fn(),
  exists: jest.fn(() => Promise.resolve(false)),
  mkdir: jest.fn(() => Promise.resolve()),
  unlink: jest.fn(() => Promise.resolve()),
  readDir: jest.fn(() => Promise.resolve([])),
  readFile: jest.fn(() => Promise.resolve('')),
  writeFile: jest.fn(() => Promise.resolve()),
  stat: jest.fn(() => Promise.resolve({ size: 1000000, isFile: () => true })),
  read: jest.fn(() => Promise.resolve('GGUF')),
  copyFile: jest.fn(() => Promise.resolve()),
  copyFileAssets: jest.fn(() => Promise.resolve()),
  moveFile: jest.fn(() => Promise.resolve()),
  hash: jest.fn(() => Promise.resolve('mockhash')),
}));

// react-native-device-info mock
jest.mock('react-native-device-info', () => ({
  getTotalMemory: jest.fn(() => Promise.resolve(8 * 1024 * 1024 * 1024)), // 8GB
  getUsedMemory: jest.fn(() => Promise.resolve(4 * 1024 * 1024 * 1024)), // 4GB
  getFreeDiskStorage: jest.fn(() => Promise.resolve(50 * 1024 * 1024 * 1024)), // 50GB
  getBuildNumber: jest.fn(() => '1784144537'), // versionCode (Android) / CFBundleVersion (iOS)
  getModel: jest.fn(() => 'Test Device'),
  getSystemName: jest.fn(() => 'Android'),
  getSystemVersion: jest.fn(() => '13'),
  isEmulator: jest.fn(() => Promise.resolve(false)),
  getDeviceId: jest.fn(() => 'test-device-id'),
  getHardware: jest.fn(() => Promise.resolve('unknown')),
}));

// react-native-image-picker mock
jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(() => Promise.resolve({
    assets: [{
      uri: 'file:///mock/image.jpg',
      type: 'image/jpeg',
      fileName: 'image.jpg',
      width: 1024,
      height: 768,
    }],
  })),
  launchCamera: jest.fn(() => Promise.resolve({
    assets: [{
      uri: 'file:///mock/camera.jpg',
      type: 'image/jpeg',
      fileName: 'camera.jpg',
      width: 1024,
      height: 768,
    }],
  })),
}));

// react-native-keychain mock
jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(() => Promise.resolve(true)),
  getGenericPassword: jest.fn(() => Promise.resolve(false)),
  resetGenericPassword: jest.fn(() => Promise.resolve(true)),
}));


// @react-native-voice/voice mock
jest.mock('@react-native-voice/voice', () => ({
  start: jest.fn(() => Promise.resolve()),
  stop: jest.fn(() => Promise.resolve()),
  destroy: jest.fn(() => Promise.resolve()),
  isAvailable: jest.fn(() => Promise.resolve(true)),
  onSpeechStart: null,
  onSpeechEnd: null,
  onSpeechResults: null,
  onSpeechError: null,
}));

// @react-native-documents/picker mock
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(() => Promise.resolve([{
    uri: 'file:///mock/document.txt',
    name: 'document.txt',
    type: 'text/plain',
    size: 1234,
  }])),
  types: {
    allFiles: '*/*',
    plainText: 'text/plain',
    csv: 'text/csv',
    pdf: 'application/pdf',
  },
  isErrorWithCode: jest.fn(() => false),
  errorCodes: {
    OPERATION_CANCELED: 'OPERATION_CANCELED',
  },
}));

// @react-native-documents/viewer mock
jest.mock('@react-native-documents/viewer', () => ({
  viewDocument: jest.fn(() => Promise.resolve(null)),
  isErrorWithCode: jest.fn(() => false),
  errorCodes: {
    UNABLE_TO_OPEN: 'UNABLE_TO_OPEN',
  },
}));

// A Swipeable whose swipe-revealed right actions (delete buttons etc.) are RENDERED, so those gestures are
// reachable in tests (jest can't simulate the drag, but the actions a swipe reveals become tappable). Used
// for both the barrel export and the direct import below.
const makeMockSwipeable = () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, renderRightActions, renderLeftActions }: { children?: unknown; renderRightActions?: () => unknown; renderLeftActions?: () => unknown }) =>
    React.createElement(View, {}, children as never, renderRightActions ? (renderRightActions() as never) : null, renderLeftActions ? (renderLeftActions() as never) : null);
};

// react-native-gesture-handler mock
jest.mock('react-native-gesture-handler', () => {
  const MockView = 'View';
  const MockSwipeable = makeMockSwipeable();
  const mockGestureBuilder = () => {
    const gesture: any = {
      activeOffsetX: () => gesture,
      activeOffsetY: () => gesture,
      minDuration: () => gesture,
      onStart: () => gesture,
      onUpdate: () => gesture,
      onEnd: () => gesture,
    };
    return gesture;
  };
  return {
    Swipeable: MockSwipeable,
    GestureHandlerRootView: MockView,
    GestureDetector: MockView,
    ScrollView: MockView,
    PanGestureHandler: MockView,
    TapGestureHandler: MockView,
    State: {},
    Directions: {},
    Gesture: {
      Pan: mockGestureBuilder,
      Tap: mockGestureBuilder,
      LongPress: mockGestureBuilder,
      Race: (..._gestures: any[]) => ({}),
      Simultaneous: (..._gestures: any[]) => ({}),
      Exclusive: (..._gestures: any[]) => ({}),
    },
  };
});

// Mock the direct import of Swipeable
jest.mock('react-native-gesture-handler/Swipeable', () => makeMockSwipeable());

// react-native-worklets mock — must come before reanimated
jest.mock('react-native-worklets', () => ({}));

// react-native-reanimated mock — fully manual to avoid loading native worklets
jest.mock('react-native-reanimated', () => {
  const { View, Text, Image } = require('react-native');
  return {
    __esModule: true,
    default: {
      createAnimatedComponent: (component: any) => component || View,
      addWhitelistedNativeProps: jest.fn(),
      addWhitelistedUIProps: jest.fn(),
      View,
      Text,
      Image,
    },
    useSharedValue: jest.fn((init: any) => ({ value: init })),
    useAnimatedStyle: jest.fn((fn: any) => fn()),
    useDerivedValue: jest.fn((fn: any) => ({ value: fn() })),
    useAnimatedProps: jest.fn((fn: any) => fn()),
    useReducedMotion: jest.fn(() => false),
    withSpring: jest.fn((val: any) => val),
    withTiming: jest.fn((val: any) => val),
    withDelay: jest.fn((_: any, val: any) => val),
    withSequence: jest.fn((...vals: any[]) => vals[vals.length - 1]),
    withRepeat: jest.fn((val: any) => val),
    cancelAnimation: jest.fn(),
    Easing: {
      linear: jest.fn(),
      ease: jest.fn(),
      bezier: jest.fn(() => jest.fn()),
      in: jest.fn(),
      out: jest.fn(),
      inOut: jest.fn(),
    },
    FadeIn: { duration: jest.fn().mockReturnThis(), delay: jest.fn().mockReturnThis() },
    FadeOut: { duration: jest.fn().mockReturnThis(), delay: jest.fn().mockReturnThis() },
    SlideInDown: { duration: jest.fn().mockReturnThis() },
    SlideOutDown: { duration: jest.fn().mockReturnThis() },
    Layout: { duration: jest.fn().mockReturnThis() },
    createAnimatedComponent: (component: any) => component || View,
  };
});

// react-native-haptic-feedback mock
jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));





// @op-engineering/op-sqlite mock
jest.mock('@op-engineering/op-sqlite', () => {
  const mockResults = { rows: [], insertId: 0, rowsAffected: 0 };
  const mockDb = {
    executeSync: jest.fn(() => mockResults),
    execute: jest.fn(() => Promise.resolve(mockResults)),
    close: jest.fn(),
    delete: jest.fn(),
  };
  return {
    open: jest.fn(() => mockDb),
  };
});

// react-native-zip-archive mock
jest.mock('react-native-zip-archive', () => ({
  unzip: jest.fn(() => Promise.resolve('/mock/unzipped/path')),
  zip: jest.fn(() => Promise.resolve('/mock/zipped/path')),
}));


// Mock react-native-vector-icons
jest.mock('react-native-vector-icons/Feather', () => 'Icon');

// react-native-spotlight-tour mock
jest.mock('react-native-spotlight-tour', () => ({
  SpotlightTourProvider: ({ children }: { children: React.ReactNode }) => children,
  AttachStep: ({ children }: { children: React.ReactNode }) => children,
  useSpotlightTour: () => ({
    start: jest.fn(),
    stop: jest.fn(),
    next: jest.fn(),
    previous: jest.fn(),
    goTo: jest.fn(),
    current: 0,
    status: 'idle',
    pause: jest.fn(),
    resume: jest.fn(),
  }),
}));

// react-native-screens mock — the native Screen/ScreenStack components are undefined in jest, which
// crashes @react-navigation/native-stack ($$typeof undefined). Map them to plain Views so a REAL
// NavigationContainer + navigator mounts and real cross-screen navigation can be driven in tests.
jest.mock('react-native-screens', () => {
  const RN = require('react-native');
  const noop = () => {};
  const base: Record<string, unknown> = {
    enableScreens: noop, enableFreeze: noop, screensEnabled: () => false,
    Screen: RN.View, ScreenContainer: RN.View, ScreenStack: RN.View, ScreenStackHeaderConfig: RN.View,
    NativeScreen: RN.View, NativeScreenContainer: RN.View, FullWindowOverlay: RN.View,
  };
  return new Proxy(base, { get: (t, p) => (p in t ? t[p as string] : RN.View) });
});

// react-native-safe-area-context mock — use the library's SHIPPED jest mock, which exports the full
// surface (SafeAreaInsetsContext / SafeAreaFrameContext / initialWindowMetrics) that @react-navigation's
// SafeAreaProviderCompat reads. The old hand-rolled mock omitted the contexts, so a real
// NavigationContainer could not mount (useContext(undefined)).
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// ============================================================================
// Global Test Utilities
// ============================================================================

const { Animated } = require('react-native');

const instantAnimation = (value?: { setValue?: (next: number) => void }, toValue?: number) => ({
  start: (callback?: (result: { finished: boolean }) => void) => {
    if (typeof toValue === 'number') {
      value?.setValue?.(toValue);
    }
    callback?.({ finished: true });
  },
  stop: jest.fn(),
  reset: jest.fn(),
});

jest.spyOn(Animated, 'timing').mockImplementation((value: any, config: any) => instantAnimation(value, config?.toValue) as any);
jest.spyOn(Animated, 'spring').mockImplementation((value: any, config: any) => instantAnimation(value, config?.toValue) as any);
jest.spyOn(Animated, 'delay').mockImplementation(() => instantAnimation() as any);
function makeGroupAnimation(animations: any[]) {
  return {
    start: (callback?: (result: { finished: boolean }) => void) => {
      animations.forEach(animation => animation?.start?.());
      callback?.({ finished: true });
    },
    stop: jest.fn(),
    reset: jest.fn(),
  } as any;
}
jest.spyOn(Animated, 'sequence').mockImplementation((...args: unknown[]) =>
  makeGroupAnimation(args[0] as any[])
);
jest.spyOn(Animated, 'parallel').mockImplementation((...args: unknown[]) =>
  makeGroupAnimation(args[0] as any[])
);
jest.spyOn(Animated, 'stagger').mockImplementation((...args: unknown[]) => {
  const animations = args[1] as any[];
  return Animated.parallel(animations) as any;
});
jest.spyOn(Animated, 'loop').mockImplementation((animation: any) => ({
  start: (callback?: (result: { finished: boolean }) => void) => {
    animation?.start?.();
    callback?.({ finished: true });
  },
  stop: jest.fn(),
  reset: jest.fn(),
}) as any);

if (!shouldPrintJestConsole) {
  console.log = jest.fn();
  console.debug = jest.fn();
  console.info = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
}

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  clearMockStorage();
});

// Global test isolation for the native-boundary harness. Tests that call installNativeBoundary()
// jest.resetModules() mid-test, which forks React Testing Library so its OWN auto-cleanup can't register
// (requireRTL deliberately skips it to avoid the "hook after tests started" error). Without cleanup,
// mounted screens persist and their store/residency writes BLEED into the next test (order-dependent
// flakiness, far worse in-band). This afterEach requires RTL AFTER the test's resetModules, so it resolves
// the SAME post-reset instance the test rendered on, and unmounts its tree. It also drops the global
// `window` shim the harness installs for React 19's error reporter, so no true-global leaks across files.
afterEach(() => {
  // Only unmount when a test actually rendered via requireRTL (which stashed its own cleanup here). Do NOT
  // require RTL fresh — after a test's resetModules that pulls a new module graph and breaks the next test.
  const g = globalThis as unknown as { __RTL_CLEANUP__?: () => void };
  if (g.__RTL_CLEANUP__) { try { g.__RTL_CLEANUP__(); } catch { /* already torn down */ } g.__RTL_CLEANUP__ = undefined; }
});

// Global timeout for async operations
jest.setTimeout(10000);
