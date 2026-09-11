import { Dimensions, StyleSheet } from 'react-native';
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

let applicationFixture:
  | import('../../harness/mobileApplicationFixture').MobileApplicationFixture
  | undefined;

afterEach(async () => {
  await applicationFixture?.dispose();
  applicationFixture = undefined;
});

async function renderEmptyManagerFromHome() {
  installNativeBoundary({ fs: true });
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  if (!g.window) {
    g.window = {
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }

  const React = require('react');
  const rtl = requireRTL();
  const AsyncStorage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  const { startMobileApplicationFixture } =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  applicationFixture = await startMobileApplicationFixture();
  const { HomeScreen } = require('../../../src/screens/HomeScreen');
  const view = rtl.render(
    React.createElement(HomeScreen, {
      navigation: {
        navigate: () => {},
        goBack: () => {},
        setOptions: () => {},
        addListener: () => () => {},
      },
    }),
  );
  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByTestId('models-summary')),
  );
  await rtl.waitFor(() =>
    expect(view.getByTestId('app-sheet-surface')).toBeTruthy(),
  );
  return { rtl, view };
}

describe('models manager sheet presentation', () => {
  it('sizes to its rows (no fixed height, bounded by the screen) with every ready model row visible', async () => {
    const { view: ui } = await renderEmptyManagerFromHome();
    const sheetStyle = StyleSheet.flatten(
      ui.getByTestId('app-sheet-surface').props.style,
    );
    // The sheet has no fixed height: it takes the height of its rows and is only capped by the screen,
    // so there is no empty space below the last row.
    expect(sheetStyle.height).toBeUndefined();
    expect(sheetStyle.maxHeight).toBeLessThanOrEqual(
      Dimensions.get('window').height,
    );
    expect(sheetStyle.maxHeight).toBeGreaterThan(0);
    for (const type of ['text', 'image', 'voice', 'speech']) {
      expect(ui.getByTestId(`models-row-${type}`)).toBeTruthy();
    }
  });

  it('keeps all rows visible while one model is loading', async () => {
    const React = require('react');
    const rtl = requireRTL();
    const {
      ModelsManagerSheet,
    } = require('../../../src/components/models/ModelsManagerSheet');
    const ui = rtl.render(
      React.createElement(ModelsManagerSheet, {
        visible: true,
        onClose: jest.fn(),
        labels: {
          text: 'Qwen 3.5',
          image: 'Flux',
          voice: 'Kokoro',
          speech: 'Whisper',
        },
        loadingState: { isLoading: true, type: 'text' },
        isEjecting: false,
        hasActiveModel: false,
        onOpenRow: jest.fn(),
        onEject: jest.fn(),
      }),
    );

    expect(await ui.findByText('Loading...')).toBeTruthy();
    for (const type of ['text', 'image', 'voice', 'speech']) {
      expect(ui.getByTestId(`models-row-${type}`)).toBeTruthy();
    }
  });

  it('shows the complete empty selection state instead of a blank sheet', async () => {
    const { view: ui } = await renderEmptyManagerFromHome();

    expect(await ui.findAllByText('—')).toHaveLength(4);
    for (const type of ['text', 'image', 'voice', 'speech']) {
      expect(ui.getByTestId(`models-row-${type}`)).toBeTruthy();
    }
  });
});
