jest.mock('../../../src/services/modelServices', () => ({ selectMobileModel: jest.fn() }));
jest.mock('../../../src/theme', () => ({ useTheme: () => ({ colors: {} }) }));

import { remoteSelectionFailureText } from '../../../src/components/models/RemoteModelOptionsSection';

describe('remoteSelectionFailureText', () => {
  it('says the device is away and that local models keep working', () => {
    expect(remoteSelectionFailureText('Ogad all', new Error('Network request failed'))).toBe(
      "Ogad all can't be reached right now. Models on this phone keep working.",
    );
    expect(remoteSelectionFailureText('Ogad all', new TypeError('Failed to fetch'))).toContain("can't be reached");
  });

  it('keeps a specific server message and falls back when there is none', () => {
    expect(remoteSelectionFailureText('Ogad all', new Error('Model is loading, try again'))).toBe('Model is loading, try again');
    expect(remoteSelectionFailureText('Ogad all', undefined)).toBe('Ogad all could not take this model right now.');
  });
});
