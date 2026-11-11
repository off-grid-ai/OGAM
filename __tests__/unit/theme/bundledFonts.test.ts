/**
 * On Android every font choice except the default uses a font file shipped inside Atlas, so it
 * looks the same on every phone (system font names like "casual" or "serif" are replaced by
 * the system font on Motorola and Samsung phones, and every choice looked the same there).
 */
import fs from 'fs';
import path from 'path';

it('points every Android font choice at a font file bundled with the app, with its licence', () => {
  let choices: Array<{ id: string; heading: string; body: string }> = [];
  jest.isolateModules(() => {
    require('react-native').Platform.OS = 'android';
    choices = require('../../../src/theme/appearance').FONT_CHOICES;
  });
  const dir = path.join(__dirname, '../../../android/app/src/main/assets/fonts');
  const files = fs.readdirSync(dir);
  for (const c of choices.filter((x) => x.id !== 'atlas')) {
    for (const family of [c.heading, c.body]) {
      expect(family).toMatch(/^Atlas/);
      expect(files.some((f) => f === `${family}.ttf` || f === `${family}.otf`)).toBe(true);
    }
  }
  expect(files.filter((f) => f.startsWith('OFL-')).length).toBeGreaterThanOrEqual(5);
});
