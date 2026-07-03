import React from 'react';
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import {
  registerSettingsSection,
  getSettingsSections,
  useSettingsSections,
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

  it('re-renders a mounted consumer when a section registers afterwards (F6 reactivity)', () => {
    // The Pro-activation flow registers a Settings section AFTER SettingsScreen mounted;
    // without reactivity the screen showed nothing until an app restart. useSettingsSections
    // must push the update to an already-mounted consumer.
    const Consumer = () => {
      const sections = useSettingsSections();
      return React.createElement(Text, { testID: 'count' }, `sections:${sections.length}`);
    };
    const { getByTestId } = render(React.createElement(Consumer));
    expect(getByTestId('count').props.children).toBe('sections:0');

    act(() => { registerSettingsSection(FakeSection); });
    expect(getByTestId('count').props.children).toBe('sections:1');

    // A no-op re-register (dev Fast Refresh) must not spuriously bump the count.
    act(() => { registerSettingsSection(FakeSection); });
    expect(getByTestId('count').props.children).toBe('sections:1');
  });
});
