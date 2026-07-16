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
  '/__tests__/pro/',
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
    // Anchored to <rootDir>/pro/ so it ignores ONLY the submodule's own tests, NOT this
    // repo's __tests__/pro/** pro-dependent suites (a bare '/pro/' matched both).
    // The pro-DEPENDENT suites under this repo's __tests__ DO run against the real pro
    // when it's checked out, and are ignored only when pro is genuinely absent.
    '<rootDir>/pro/',
    ...(proExists ? [] : proDependentTestPaths),
  ],
  // Stale agent git-worktrees under .claude/worktrees/ each carry a full repo copy (incl. their own
  // pro/package.json named @offgrid/pro), which collide in Haste's module map and make require('@offgrid/pro')
  // throw ("looked up in the Haste module map ... several different files"). Exclude them so the ONE real
  // @offgrid/pro resolves — and so those copies aren't test-collected as duplicates.
  modulePathIgnorePatterns: ['<rootDir>/.claude/worktrees/'],
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
    // Measure the pro submodule too when it's checked out (the pro-dependent suites here
    // exercise it). Skip barrels (index.ts) + type decls; index.tsx (real components) stays.
    ...(proExists
      ? ['pro/**/*.{ts,tsx}', '!pro/**/index.ts', '!pro/**/*.d.ts', '!pro/**/__tests__/**', '!pro/**/*.test.{ts,tsx}']
      : []),
  ],
  coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],
  coverageThreshold: {
    // `global` gates src/ at 80. A glob key REMOVES matching files from `global` and gates
    // them separately — so the pro group below carves pro out of the src gate.
    global: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
    // pro/ is MEASURED here (visible in the core report + regression-guarded), carved out
    // of the src `global` gate into its own group. The pro-dependent suites in this repo
    // (incl. the __tests__/pro/** real-behavior tests) cover ~60% of pro; this floor
    // ratchets that so it can't slide, and is raised as more pro tests land. New pro
    // modules also add their own per-file 100 key. NOTE: this is a DIRECTORY key (not a
    // glob) so jest aggregates all pro files into ONE group — a glob (`pro/**`) would apply
    // per-file and fail on the many pro files no core suite imports.
    './pro': { statements: 88, branches: 80, functions: 82, lines: 89 },
    // New standalone modules in this change set are held to 100% on every axis. Changed
    // legacy files have their NEW branches covered by the suites but aren't whole-file-100%.
    './src/utils/imageModelIntegrity.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
    './src/utils/imageGenAdvice.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
    './src/utils/exportConversation.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
    './src/services/modelLoadErrors.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
    './src/components/ImageGenAdviceCard.tsx': { statements: 100, branches: 100, functions: 100, lines: 100 },
    './src/components/VoiceRecordButton/derive.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};
