import { spaceProblem } from '../../src/atlasTools/emergencyTiers';

describe('free space before building an emergency package', () => {
  it('is fine when there is room for the packs and the zip', () => expect(spaceProblem(1e9, 2.5e9)).toBeNull());
  it('says how much is needed and how much is free when there is not', () => {
    expect(spaceProblem(3e9, 4e9)).toBe('This size needs about 6.0 GB free on the phone while it is built, and 4.0 GB is free. Free some space or pick a smaller size.');
  });
  it('does not block when the free space is unknown', () => {
    expect(spaceProblem(3e9, undefined)).toBeNull();
    expect(spaceProblem(3e9, NaN)).toBeNull();
  });
});
