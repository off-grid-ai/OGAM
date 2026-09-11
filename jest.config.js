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
// absent. When Pro exists, its own suites are part of this repository-level gate too.
const proDependentTestPaths = [
  '/__tests__/pro/',
  '/__tests__/unit/engine/',
  '/__tests__/integration/audio/',
  '__tests__/unit/audioProgressCaption.test.ts',
  '__tests__/unit/services/ttsService.test.ts',
  '__tests__/rntl/components/PlaybackControls.test.tsx',
  '__tests__/rntl/components/KokoroTTSBridge.test.tsx',
  '__tests__/rntl/components/McpAddServerSheet.test.tsx',
  '__tests__/unit/tools/mcpPresets.test.ts',
];

const jestConfig = {
  preset: 'react-native',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/android/',
    '/ios/',
    '/e2e/',
    'App.test.tsx',
    // Pro's own tests and the core Pro-dependent suites run together when the submodule exists.
    // Open-core CI ignores only the dependent core suites because there is no Pro checkout.
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
    // Run Shared semantic package entries from source, as @offgrid/sync does below.
    // The package root must also resolve to its public source entry. Sending the generated ~1MB
    // CommonJS bundle back through the React Native Babel/worklets transform stalls Jest and loses
    // source-level coverage identity.
    '^@offgrid/models$': '<rootDir>/../shared/packages/models/src/index.ts',
    '^@offgrid/models/catalog$':
      '<rootDir>/../shared/packages/models/src/catalog/index.ts',
    '^@offgrid/models/quant$':
      '<rootDir>/../shared/packages/models/src/quant.ts',
    // Mirrors the metro alias: the real pro package when present on disk, else the null
    // stub so open-core tests resolve @offgrid/pro cleanly.
    '^@offgrid/pro$': proExists
      ? '<rootDir>/pro'
      : '<rootDir>/src/bootstrap/proStub.js',
    '^@offgrid/pro/(.*)$': proExists
      ? '<rootDir>/pro/$1'
      : '<rootDir>/src/bootstrap/proStub.js',
    // Mirrors the metro alias: 'react-native-fs' resolves to the maintained fork
    // (the only RNFS native module we ship — see metro.config.js).
    '^react-native-fs$': '<rootDir>/src/shims/react-native-fs.ts',
    // @offgrid/sync: test against SOURCE (jest transforms the TS) rather than the tsup dist,
    // which references @babel/runtime helpers not resolvable from the out-of-root package. Keep
    // these subpaths in step with metro.config.js's aliases and the package's exports map.
    '^@offgrid/sync$': '<rootDir>/../shared/packages/sync/src/index.ts',
    '^@offgrid/sync/rn$':
      '<rootDir>/../shared/packages/sync/src/adapters/rn-tcp.ts',
    '^@offgrid/sync/rn-discovery$':
      '<rootDir>/../shared/packages/sync/src/adapters/rn-discovery.ts',
    '^@offgrid/sync/portable$':
      '<rootDir>/../shared/packages/sync/src/portable/index.ts',
    // The sync source lives out-of-root; when jest transforms it, babel injects @babel/runtime
    // helper imports that would otherwise resolve from ../shared (where they aren't installed).
    // Pin them to mobile's own copy.
    '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|react-native-.*|@react-native-.*|moti|@motify|@gorhom|@shopify|@ronradtke|@op-engineering|@offgrid)/)',
  ],
  testEnvironment: 'node',
  // Istanbul instrumentation retained one transformed copy of every source file in the
  // coordinator, so worker recycling could not prevent the full matrix from reaching the
  // 8 GB heap ceiling. V8 records counters in each recyclable worker and Jest still merges
  // them into one report for inspection.
  coverageProvider: 'v8',
  // One worker keeps stateful React Native suites serial, while an idle-memory
  // limit lets Jest replace that worker between files. `--runInBand` runs in the
  // coordinator process, where Jest cannot recycle the growing module and
  // instrumentation graph; the full coverage matrix eventually exhausted even
  // an 8 GB heap. Coverage from replacement workers is still merged by Jest.
  workerIdleMemoryLimit: process.env.JEST_WORKER_IDLE_MEMORY_LIMIT || '512MB',
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
      ? [
          'pro/**/*.{ts,tsx}',
          '!pro/**/index.ts',
          '!pro/**/*.d.ts',
          '!pro/**/__tests__/**',
          '!pro/**/*.test.{ts,tsx}',
        ]
      : []),
  ],
  coverageReporters: ['text', 'text-summary', 'lcov', 'json', 'json-summary'],
};

module.exports = jestConfig;
