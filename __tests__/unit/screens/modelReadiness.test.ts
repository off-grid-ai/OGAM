import {
  modelNotReadyAlert,
  reasonFromLoadError,
} from '../../../src/screens/ChatScreen/modelReadiness';

describe('Mobile chat readiness projection', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses the canonical Shared failure reason and copy', () => {
    expect(reasonFromLoadError(new Error('insufficient memory'))).toBe('insufficient-memory');
    expect(modelNotReadyAlert('not-downloaded').title).toBe('Model Not Downloaded');
  });
});
