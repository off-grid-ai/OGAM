module.exports = {
  root: true,
  extends: [
    '@react-native',
    // SonarJS: Sonar-grade bug/smell detection in normal lint — free, local, and it covers
    // PRO too (pro has no cloud Sonar project; a private cloud project is paid-by-LOC). Most
    // rules stay at `error` (recommended default) as a forward guard; the handful already
    // tripped on legacy code are `warn` below with a logged burn-down (GAPS_BACKLOG).
    'plugin:sonarjs/recommended-legacy',
  ],
  plugins: [
    'react-native',
    'react',
    'react-hooks',
    'sonarjs',
  ],
  env: {
    jest: true,
    browser: true,
    node: true,
    es6: true,
  },
  rules: {
    // TypeScript
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': 'error',

    // Code quality (built-in)
    'no-empty': 'error',
    'no-else-return': 'error',
    'prefer-template': 'error',
    // Dead-branch killers (the "AI leftover" class) — untyped, cheap, high signal, zero current hits.
    'no-unreachable': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-constant-binary-expression': 'error',
    complexity: ['error', 20],
    'max-lines-per-function': ['error', 350],
    'max-lines': ['error', 500],
    'max-params': ['error', 3],
    // React hooks
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // React Native
    'react-native/no-unused-styles': 'error',
    'react-native/no-inline-styles': 'error',
    'react-native/no-color-literals': 'error',
    'react-native/no-raw-text': 'error',
    'react-native/no-single-element-style-arrays': 'error',

    // SonarJS — every rule stays at the recommended `error` (a real forward guard on new code)
    // EXCEPT the two handled here:
    //  - no-duplicate-string OFF: it fights RN styling — 'space-between'/'center'/'row' and color
    //    literals repeat by design across StyleSheet objects; a constant per style value is noise,
    //    not clarity. The one low-value SonarJS rule for this codebase.
    //  - the rest are `warn` (already tripped on legacy core; burn-down in docs/GAPS_BACKLOG.md,
    //    ratchet each back to `error` as its count hits zero).
    'sonarjs/no-duplicate-string': 'off',
    'sonarjs/prefer-single-boolean-return': 'warn',
    'sonarjs/no-nested-template-literals': 'warn',
    'sonarjs/no-collapsible-if': 'warn',
    'sonarjs/prefer-immediate-return': 'warn',
    'sonarjs/no-duplicated-branches': 'warn',
  },
  overrides: [
    {
      // Relax structural rules in test files — large test suites and helpers are acceptable
      files: ['__tests__/**/*', '*.test.ts', '*.test.tsx', 'jest.setup.ts'],
      rules: {
        'max-lines': 'off',
        'max-lines-per-function': 'off',
        'max-params': 'off',
        complexity: 'off',
        'react-native/no-inline-styles': 'off',
        'react-native/no-raw-text': 'off',
        'react-native/no-color-literals': 'off',
        // Duplicate test bodies (identical arrange/act across cases) are acceptable and clearer
        // than over-DRYing tests; the real-bug SonarJS rules (mischeck, unused-collection, etc.)
        // stay ON for tests — they caught a tautology assertion + a dead collection here.
        'sonarjs/no-identical-functions': 'off',
        'sonarjs/cognitive-complexity': 'off',
      },
    },
  ],
};
