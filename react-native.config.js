const fs = require('node:fs');
const path = require('node:path');

// Pro's native modules (Video Studio film join) live in the private pro/ submodule. Autolink them
// only when pro/ is checked out, so the open-source build compiles and runs without them.
const filmRoot = path.resolve(__dirname, 'pro/native/film');
const proExists = fs.existsSync(path.resolve(__dirname, 'pro/package.json'));

module.exports = {
  dependencies: proExists && fs.existsSync(filmRoot) ? { '@offgrid/film-native': { root: filmRoot } } : {},
};
