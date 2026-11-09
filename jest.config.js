module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  testPathIgnorePatterns: [
    '/node_modules/', '/android/', '/ios/', '/e2e/', 'App.test.tsx',
  ],
  // Stale agent git-worktrees under .claude/worktrees/ each carry a full repo copy, which collide in Haste's
  // module map. Exclude them so they are not test-collected as duplicates.
  modulePathIgnorePatterns: ['<rootDir>/.claude/worktrees/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Mirrors the metro alias.
    '^@offgrid/core/(.*)$': '<rootDir>/src/$1',
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
    // `global` gates src/ at 80. A path key REMOVES matching files from `global` and gates them separately.
    global: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
    // New standalone modules in this change set are held to 100% on every axis. Changed
    // legacy files have their NEW branches covered by the suites but aren't whole-file-100%.
    './src/utils/imageModelIntegrity.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
    './src/utils/imageGenAdvice.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
    './src/services/modelLoadErrors.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
    './src/components/ImageGenAdviceCard.tsx': { statements: 100, branches: 100, functions: 100, lines: 100 },
    './src/components/VoiceRecordButton/derive.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};
