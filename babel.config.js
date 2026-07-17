const isTest = process.env.NODE_ENV === 'test';

module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    !isTest && ['babel-plugin-react-compiler', { target: '19' }],
    // Test-only: transform `import()` into a require()-based promise so jest (which runs under
    // CommonJS, not --experimental-vm-modules) can execute dynamic imports of our own modules.
    // No effect on the Metro/RN build (isTest-gated). Lets rendered tests exercise code paths that
    // lazy-import services (e.g. LocketInsights' auto-generate) without mocking our own code.
    isTest && '@babel/plugin-transform-dynamic-import',
    'react-native-worklets/plugin',
  ].filter(Boolean),
};
