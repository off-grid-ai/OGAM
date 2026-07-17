const isTest = process.env.NODE_ENV === 'test';

module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    !isTest && ['babel-plugin-react-compiler', { target: '19' }],
    'react-native-worklets/plugin',
  ].filter(Boolean),
  // Test-only, and SCOPED to the locket screens only: transform `import()` into a require()-based
  // promise so jest (CommonJS, no --experimental-vm-modules) can execute the locket detail screen's
  // lazy service import (its auto-generate path) without mocking our own code. Kept narrow on
  // purpose — a global transform changed dynamic-import behavior elsewhere (e.g. loadProFeatures'
  // `await import('@offgrid/pro')`) and broke the pro-bootstrap tests. No effect on the RN build.
  overrides: isTest
    ? [{ test: /pro\/locket\/screens\//, plugins: ['@babel/plugin-transform-dynamic-import'] }]
    : [],
};
