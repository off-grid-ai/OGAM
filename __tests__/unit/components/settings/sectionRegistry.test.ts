import {
  registerSettingsSection,
  getSettingsSections,
  _clearSectionsForTesting,
} from '../../../../src/components/settings/sectionRegistry';

const FakeSection = () => null;
const AnotherSection = () => null;

describe('settings section registry', () => {
  beforeEach(() => {
    _clearSectionsForTesting();
  });

  it('returns empty array when nothing registered', () => {
    expect(getSettingsSections()).toEqual([]);
  });

  it('registers a section component', () => {
    registerSettingsSection(FakeSection);
    expect(getSettingsSections()).toHaveLength(1);
    expect(getSettingsSections()[0]).toBe(FakeSection);
  });

  it('registers multiple sections in order', () => {
    registerSettingsSection(FakeSection);
    registerSettingsSection(AnotherSection);
    const sections = getSettingsSections();
    expect(sections).toHaveLength(2);
    expect(sections[0]).toBe(FakeSection);
    expect(sections[1]).toBe(AnotherSection);
  });
});
