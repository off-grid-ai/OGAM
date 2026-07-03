const path = require('node:path');
const fs = require('node:fs');

// pro/ is a git submodule: the directory exists even when not checked out, so detect a
// real file inside it (package.json). Mirrors metro.config.js's proExists. When pro IS
// checked out (store builds + the pro repo's PAT in CI), we run the pro-dependent suites
// against the REAL pro package instead of stubbing it — so a green public-CI run that
// pulled the submodule actually exercises TTS/MCP/audio, not a stub. Only when pro is
// genuinely absent (open-core CI without the PAT) do we ignore those suites and map
// @offgrid/pro to the null stub, so the open-core suite still runs and stays green.
const proExists = fs.existsSync(path.resolve(__dirname, 'pro/package.json'));

// Suites under THIS repo's __tests__ that import @offgrid/pro. Ignored ONLY when pro is
// absent. (pro/'s OWN suite is always ignored here — it runs in the pro repo's CI.)
const proDependentTestPaths = [
  '/__tests__/unit/audio/',
  '/__tests__/unit/engine/',
  '/__tests__/integration/audio/',
  '__tests__/unit/audioProgressCaption.test.ts',
  '__tests__/unit/mcp/McpToolExtension.test.ts',
  '__tests__/unit/services/ttsService.test.ts',
  '__tests__/unit/stores/ttsStore.test.ts',
  '__tests__/integration/stores/tts.test.ts',
  '__tests__/rntl/components/ChatInputModeToggle.test.tsx',
  '__tests__/rntl/components/PlaybackControls.test.tsx',
  '__tests__/rntl/components/VoiceModelsPanel.test.tsx',
  '__tests__/rntl/components/KokoroTTSBridge.test.tsx',
  '__tests__/rntl/components/McpAddServerSheet.test.tsx',
  '__tests__/rntl/components/McpServersScreen.test.tsx',
  '__tests__/unit/tools/mcpPresets.test.ts',
];

module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  testPathIgnorePatterns: [
    '/node_modules/', '/android/', '/ios/', '/e2e/', 'App.test.tsx',
    // pro/ ships its own suite run in the pro repo's CI — never run those from here.
    // The pro-DEPENDENT suites under this repo's __tests__ DO run against the real pro
    // when it's checked out, and are ignored only when pro is genuinely absent.
    '/pro/',
    ...(proExists ? [] : proDependentTestPaths),
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Mirrors the metro alias so tests can import pro modules that reference core.
    '^@offgrid/core/(.*)$': '<rootDir>/src/$1',
    // Mirrors the metro alias: the real pro package when present on disk, else the null
    // stub so open-core tests resolve @offgrid/pro cleanly.
    '^@offgrid/pro$': proExists ? '<rootDir>/pro' : '<rootDir>/src/bootstrap/proStub.js',
    '^@offgrid/pro/(.*)$': proExists ? '<rootDir>/pro/$1' : '<rootDir>/src/bootstrap/proStub.js',
    // Mirrors the metro alias: 'react-native-fs' resolves to the maintained fork
    // (the only RNFS native module we ship — see metro.config.js).
    '^react-native-fs$': '<rootDir>/src/shims/react-native-fs.ts',
  },
  transformIgnorePatterns: ['node_modules/(?!(react-native|@react-native|@react-navigation|react-native-.*|@react-native-.*|moti|@motify|@gorhom|@shopify|@ronradtke|@op-engineering|@offgrid)/)',],
  testEnvironment: 'node',
  clearMocks: true,
  verbose: true,
  testTimeout: 10000,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/index.ts',
    '!src/types/**',
    '!src/navigation/**',
  ],
  coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
  },
};
