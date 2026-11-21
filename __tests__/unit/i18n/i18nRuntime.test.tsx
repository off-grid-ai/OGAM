/** @jsxImportSource @offgrid/i18n */
// The app's JSX runs through @offgrid/i18n's runtime (metro.config.js points this app's `react/jsx-runtime`
// at it). This file compiles against it directly, so a real component renders through the same runtime: in
// English nothing changes; with a catalog, Text children, readable props and RN's joined children
// ("{count} models") show in that language, and what a person wrote stays as written.
import { Text, TextInput, View } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { setCatalog } from '@offgrid/i18n';
import { SectionLabel } from '../../../src/components/SectionLabel';

function Sample({ count }: { count: number }) {
  return (
    <View>
      <SectionLabel title="Community" />
      <Text>{count} models</Text>
      <TextInput placeholder="Search models" accessibilityLabel="Search" />
      <Text translate="no">Community</Text>
    </View>
  );
}

afterEach(() => setCatalog('en', null));

describe('the i18n JSX runtime on React Native', () => {
  it('leaves English exactly as written', () => {
    render(<Sample count={3} />);
    expect(screen.getAllByText('Community')).toHaveLength(2);
    expect(screen.getByText('3 models')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search models')).toBeTruthy();
  });

  it('shows a real component in German, numbers kept, and keeps translate="no" text', () => {
    setCatalog('de', {
      Community: 'Community-DE',
      '{0} models': '{0} Modelle',
      'Search models': 'Modelle suchen',
      Search: 'Suchen',
    });
    render(<Sample count={3} />);
    expect(screen.getByText('Community-DE')).toBeTruthy();
    expect(screen.getByText('Community')).toBeTruthy();
    expect(screen.getByText('3 Modelle')).toBeTruthy();
    expect(screen.getByPlaceholderText('Modelle suchen')).toBeTruthy();
    expect(screen.getByLabelText('Suchen')).toBeTruthy();
  });
});
