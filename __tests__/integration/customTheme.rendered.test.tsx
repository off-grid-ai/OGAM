/** Importing a theme in Appearance: a bad file says what is wrong and changes nothing; a good one is applied and a corner roundness choice sticks. */
import { requireRTL } from '../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

it('rejects a bad theme with a clear reason, applies a good one, and sets corner roundness', () => {
  const rtl = requireRTL();
  const React = require('react');
  const { AppearanceScreen } = require('../../src/screens/AppearanceScreen');
  const { useAppStore } = require('../../src/stores');
  const { getTheme } = require('../../src/theme/useTheme');
  const r = rtl.render(React.createElement(AppearanceScreen));

  rtl.fireEvent.changeText(r.getByTestId('theme-json'), '{"light":{"background":"red"}}');
  rtl.fireEvent.press(r.getByTestId('theme-apply'));
  expect(r.getByTestId('theme-msg').props.children).toMatch(/must be a hex colour/);
  expect(useAppStore.getState().settings.appearance?.custom).toBeUndefined();

  rtl.fireEvent.changeText(r.getByTestId('theme-json'), '{"name":"Warm","light":{"background":"#fff8f0","primary":"#c2410c"},"dark":{"background":"#1a1008"},"cornerRadius":1.5}');
  rtl.fireEvent.press(r.getByTestId('theme-apply'));
  const appearance = useAppStore.getState().settings.appearance;
  expect(appearance.custom.name).toBe('Warm');
  expect(getTheme('light', appearance).colors.background).toBe('#fff8f0');
  expect(getTheme('light', appearance).colors.primary).toBe('#c2410c');
  expect(getTheme('dark', appearance).colors.background).toBe('#1a1008');
  expect(getTheme('light', appearance).shape.radius).toBe(1.5);

  rtl.fireEvent.press(r.getByText('Square'));
  expect(getTheme('light', useAppStore.getState().settings.appearance).shape.radius).toBe(0);
  rtl.fireEvent.press(r.getByTestId('theme-remove'));
  expect(getTheme('light', useAppStore.getState().settings.appearance).colors.background).not.toBe('#fff8f0');

  rtl.fireEvent.press(r.getByTestId('easy-mode'));
  expect(useAppStore.getState().settings.appearance).toMatchObject({ layoutMode: 'focus', chatLayout: 'clean' });
  rtl.fireEvent.press(r.getByTestId('easy-mode'));
  expect(useAppStore.getState().settings.appearance.layoutMode).toBe('standard');
});
