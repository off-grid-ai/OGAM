/**
 * Unit tests for resolveDocumentPath — re-bases stored absolute Documents paths
 * onto the current app container (iOS changes the Data-container UUID across
 * (re)installs, stranding paths stored under an old install).
 */
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/var/mobile/Containers/Data/Application/CURRENT-UUID/Documents',
}));

import { resolveDocumentPath } from '../../../src/utils/resolveDocumentPath';

const CURRENT = '/var/mobile/Containers/Data/Application/CURRENT-UUID/Documents';

describe('resolveDocumentPath', () => {
  it('re-bases a path that carries a stale container UUID onto the current one', () => {
    const stale = '/var/mobile/Containers/Data/Application/OLD-UUID-1234/Documents/audio-input/input_123.wav';
    expect(resolveDocumentPath(stale)).toBe(`${CURRENT}/audio-input/input_123.wav`);
  });

  it('strips a file:// scheme before re-basing', () => {
    const stale = 'file:///var/mobile/Containers/Data/Application/OLD/Documents/audio-input/x.wav';
    expect(resolveDocumentPath(stale)).toBe(`${CURRENT}/audio-input/x.wav`);
  });

  it('leaves an already-current path effectively unchanged', () => {
    const current = `${CURRENT}/audio-input/today.wav`;
    expect(resolveDocumentPath(current)).toBe(current);
  });

  it('passes through a path that is not under a Documents directory (sans scheme)', () => {
    expect(resolveDocumentPath('/tmp/somewhere/else.wav')).toBe('/tmp/somewhere/else.wav');
    expect(resolveDocumentPath('file:///tmp/x.wav')).toBe('/tmp/x.wav');
  });

  it('returns empty input unchanged', () => {
    expect(resolveDocumentPath('')).toBe('');
  });
});
