const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const config = {
  watchFolders: [],
  resolver: {
    // Metro resolves peer dependencies from here.
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    extraNodeModules: {
      // Exposes src/ as @offgrid/core.
      '@offgrid/core': path.resolve(__dirname, 'src'),
      // Single source of truth for react-native-fs. The app imports
      // 'react-native-fs', but executorch's bare-resource-fetcher pulls the
      // maintained fork '@dr.pogodin/react-native-fs'. Shipping both produces
      // duplicate RNFS Objective-C symbols at link time on iOS, so we alias the
      // old name onto the fork and keep a single native module.
      'react-native-fs': path.resolve(__dirname, 'src/shims/react-native-fs.ts'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
