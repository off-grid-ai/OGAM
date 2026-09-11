const isTest = process.env.NODE_ENV === 'test';

/**
 * Instrument the app for e2e coverage, only when explicitly asked.
 *
 * Hermes has no V8 coverage API, so there is nothing to read out of a running bundle the way node can be read.
 * Coverage on a device therefore has to be compiled IN: babel-plugin-istanbul rewrites each source file to count
 * its own statements and branches into `global.__coverage__`, which is then dumped to a file at the end of a run
 * and pulled back to the host (see scripts/e2e/collect-coverage.mjs).
 *
 * Gated on an env var rather than on __DEV__ so it can never reach a release build by accident: instrumentation
 * roughly doubles the bundle and slows every function down. `E2E_COVERAGE=1` is set only by the e2e build.
 */
const withE2eCoverage = process.env.E2E_COVERAGE === '1';

module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    '@babel/plugin-transform-export-namespace-from',
    !isTest && ['babel-plugin-react-compiler', { target: '19' }],
    'react-native-worklets/plugin',
    withE2eCoverage && [
      'babel-plugin-istanbul',
      {
        // Only this app's own source. Instrumenting node_modules would bury the signal, and instrumenting the
        // tests themselves would report the harness as covered code.
        include: ['src/**/*.{ts,tsx}', 'pro/**/*.{ts,tsx}'],
        exclude: [
          '**/node_modules/**',
          '**/__tests__/**',
          '**/__mocks__/**',
          '**/*.test.{ts,tsx}',
          '**/*.d.ts',
          'scripts/**',
        ],
      },
    ],
  ].filter(Boolean),
};
