const path = require('node:path');
const fs = require('node:fs');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const proPackagePath = path.resolve(__dirname, 'pro');
const proStubPath = path.resolve(__dirname, 'src/bootstrap/proStub.js');
// pro/ is a git submodule: the directory exists even when not checked out, so test
// for a real file inside it (package.json) to detect a populated submodule.
const proExists = fs.existsSync(path.resolve(proPackagePath, 'package.json'));

const config = {
  // pro/ is a submodule inside the project root, so Metro already watches it by
  // default; nothing extra needed here. (When absent it's just an empty dir.)
  watchFolders: [],
  resolver: {
    // When resolving modules from outside the project root (i.e. @offgrid/pro),
    // Metro falls back here so @babel/runtime and all other peer deps are found.
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    extraNodeModules: {
      // Exposes src/ as @offgrid/core so @offgrid/pro can import the design system,
      // stores, and registries without a circular package dependency.
      '@offgrid/core': path.resolve(__dirname, 'src'),
      // Points to the real pro package when present on disk (store builds),
      // falls back to a null stub so free builds bundle cleanly.
      '@offgrid/pro': proExists ? proPackagePath : proStubPath,
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
