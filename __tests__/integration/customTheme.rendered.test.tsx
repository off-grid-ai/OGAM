/** Importing a theme in Appearance: a bad file says what is wrong and changes nothing; a good one is applied and a corner roundness choice sticks. */
import { requireRTL } from '../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

it('rejects a bad theme with a clear reason, applies a good one, and sets corner roundness', async () => {
  const rtl = requireRTL();
  const React = require('react');
  const { AppearanceScreen } = require('../../src/screens/AppearanceScreen');
  const { useAppStore } = require('../../src/stores');
  const { getTheme } = require('../../src/theme/useTheme');
  const r = rtl.render(React.createElement(AppearanceScreen));
  rtl.fireEvent.press(r.getByTestId('fold-shape')); // the theme, roundness and picture options sit in this group

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

it('keeps a chosen background picture in app storage, makes screens see-through, dims it, and removes it', async () => {
  const rtl = requireRTL();
  const React = require('react');
  const { AppearanceScreen } = require('../../src/screens/AppearanceScreen');
  const { useAppStore } = require('../../src/stores');
  const { getTheme } = require('../../src/theme/useTheme');
  const r = rtl.render(React.createElement(AppearanceScreen));
  rtl.fireEvent.press(r.getByTestId('fold-shape'));
  await rtl.act(async () => { await Promise.resolve(); });
  const picker = require('@react-native-documents/picker');
  (picker.pick as jest.Mock).mockResolvedValue([{ uri: 'file:///pics/wall.jpg', name: 'wall.jpg' }]);
  await rtl.act(async () => { rtl.fireEvent.press(r.getByTestId('bg-pick')); });
  await rtl.waitFor(() => expect(useAppStore.getState().settings.appearance?.backgroundImage).toBeTruthy());
  const t = getTheme('light', useAppStore.getState().settings.appearance);
  expect(t.colors.background).toBe('transparent');
  expect(t.backdrop).toMatchObject({ dim: 0.45, uri: 'file:///pics/wall.jpg' });
  rtl.fireEvent.press(r.getByText('Very dark'));
  expect(getTheme('light', useAppStore.getState().settings.appearance).backdrop.dim).toBe(0.85);
  rtl.fireEvent.press(r.getByTestId('bg-remove'));
  expect(getTheme('light', useAppStore.getState().settings.appearance).backdrop).toBeUndefined();
  expect(getTheme('light', useAppStore.getState().settings.appearance).colors.background).not.toBe('transparent');
});
