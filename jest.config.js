module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  testPathIgnorePatterns: [
    '/node_modules/', '/android/', '/ios/', '/e2e/', 'App.test.tsx',
    // The private pro/ submodule ships its own test suite and runs it in the pro
    // repo's own CI. The public repo's CI does not (and must not) check it out, so
    // ignore it here too — locally it's present and would otherwise be picked up.
    '/pro/',
    // Audio/TTS suites import the private pro/ submodule, which the public repo's
    // CI does not (and must not) check out. They run in the pro repo's own CI.
    '/__tests__/unit/audio/',
    '/__tests__/unit/engine/',
    '__tests__/unit/services/ttsService.test.ts',
    '__tests__/unit/stores/ttsStore.test.ts',
    '__tests__/integration/stores/tts.test.ts',
    '__tests__/rntl/components/ChatInputModeToggle.test.tsx',
    '__tests__/rntl/components/VoiceModelsPanel.test.tsx',
    '__tests__/rntl/components/KokoroTTSBridge.test.tsx',
    // MCP server/preset suites import the private pro/ submodule — run in pro's CI.
    '__tests__/rntl/components/McpAddServerSheet.test.tsx',
    '__tests__/rntl/components/McpServersScreen.test.tsx',
    '__tests__/unit/tools/mcpPresets.test.ts',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Mirrors the metro alias so tests can import pro modules that reference core.
    '^@offgrid/core/(.*)$': '<rootDir>/src/$1',
    // Mirrors the metro alias: 'react-native-fs' resolves to the maintained fork
    // (the only RNFS native module we ship — see metro.config.js).
    '^react-native-fs$': '<rootDir>/src/shims/react-native-fs.ts',
  },
  transformIgnorePatterns: ['node_modules/(?!(react-native|@react-native|@react-navigation|react-native-.*|@react-native-.*|moti|@motify|@gorhom|@shopify|@ronradtke|@op-engineering)/)',],
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
