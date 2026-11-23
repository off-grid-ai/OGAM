/**
 * The image safety classifier runs on executorch's classification task, which needs executorch's
 * opencv library. The app picks executorch's native libraries in package.json; without opencv the
 * classifier's native function is never installed, every check fails, and every generated image is
 * blocked (seen on a OnePlus Nord 5, 2026-11-23). The jest mock of executorch cannot see this, so
 * this contract reads the real build config.
 */
import pkg from '../../package.json';

describe('executorch native libraries', () => {
  it('include opencv, which the image safety classifier needs', () => {
    const config = (pkg as { 'react-native-executorch'?: { libs?: string[]; backends?: string[] } })[
      'react-native-executorch'
    ];
    expect(config?.libs).toEqual(expect.arrayContaining(['opencv']));
    expect(config?.backends).toEqual(expect.arrayContaining(['xnnpack']));
  });
});
