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
// doesn't get scheduled in time and flakes. 5s is load-tolerant yet well under the 10s
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

// react-native-purchases mock — the real package loads a native module that
// is unavailable in the node test env, so any (even transitive / coverage-only)
// require would throw. Suites that need behaviour override this with a local mock.
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    setLogLevel: jest.fn(),
    configure: jest.fn(),
    getCustomerInfo: jest.fn(() => Promise.resolve({ entitlements: { active: {} }, originalAppUserId: 'anon', allPurchaseDates: {} })),
    restorePurchases: jest.fn(() => Promise.resolve({ entitlements: { active: {} } })),
    getOfferings: jest.fn(() => Promise.resolve({ all: {}, current: null })),
    purchasePackage: jest.fn(() => Promise.resolve({ customerInfo: { entitlements: { active: {} } } })),
    logIn: jest.fn(() => Promise.resolve({ customerInfo: { entitlements: { active: {} }, originalAppUserId: 'anon' }, created: false })),
    invalidateCustomerInfoCache: jest.fn(() => Promise.resolve()),
    logOut: jest.fn(() => Promise.resolve()),
    ENTITLEMENT_VERIFICATION_MODE: { DISABLED: 'DISABLED', INFORMATIONAL: 'INFORMATIONAL' },
    VERIFICATION_RESULT: { NOT_REQUESTED: 'NOT_REQUESTED', VERIFIED: 'VERIFIED', FAILED: 'FAILED', VERIFIED_ON_DEVICE: 'VERIFIED_ON_DEVICE' },
  },
  LOG_LEVEL: { DEBUG: 'debug', ERROR: 'error' },
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

// react-native-gesture-handler mock
jest.mock('react-native-gesture-handler', () => {
  const MockView = 'View';
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
    Swipeable: MockView,
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
jest.mock('react-native-gesture-handler/Swipeable', () => 'View');

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

// @react-native-community/blur mock
jest.mock('@react-native-community/blur', () => ({
  BlurView: 'BlurView',
}));

// lottie-react-native mock
jest.mock('lottie-react-native', () => 'LottieView');

// react-native-linear-gradient mock
jest.mock('react-native-linear-gradient', () => 'LinearGradient');

// moti mock (kept for any transitive imports)
jest.mock('moti', () => ({
  MotiView: 'MotiView',
  MotiText: 'MotiText',
  MotiImage: 'MotiImage',
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}), { virtual: true });

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

// react-native-safe-area-context mock
jest.mock('react-native-safe-area-context', () => {
  const defaultInset = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: jest.fn(() => defaultInset),
  };
});

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

// Global timeout for async operations
jest.setTimeout(10000);
