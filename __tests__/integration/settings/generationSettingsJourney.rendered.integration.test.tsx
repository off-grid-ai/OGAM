/**
 * A person can change a text-generation setting from Chat, use it for the
 * next reply, and reset the visible value to the product default.
 *
 * The real Home and Chat screens, navigation stack, settings facade, model
 * application, and generation pipeline run in this journey. The downloaded
 * model file and LiteRT runtime are the external device boundaries.
 */
import {
  GB,
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';
import {
  renderProductionApp,
  seedReturningUserWithTextModel,
} from '../../harness/productionNavigation';

jest.unmock('@react-navigation/native');

describe('generation settings journey', () => {
  afterEach(async () => {
    requireRTL().cleanup();
    const { stopMobileApplication } =
      require('../../../src/services/composition/application') as typeof import('../../../src/services/composition/application');
    await stopMobileApplication();
  });

  it('applies a visible temperature change to generation and resets it', async () => {
    const boundary = installNativeBoundary({
      fs: true,
      ram: {
        platform: 'android',
        totalBytes: 12 * GB,
        availBytes: 8 * GB,
      },
    });
    const { doMockRealSqlite } =
      require('../../harness/sqliteFake') as typeof import('../../harness/sqliteFake');
    doMockRealSqlite();

    const globalObject = globalThis as unknown as {
      window?: Record<string, unknown>;
    };
    if (!globalObject.window) {
      globalObject.window = {
        dispatchEvent: () => true,
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    }

    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();

    await seedReturningUserWithTextModel(boundary, {
      id: 'settings-journey-model',
      name: 'Settings Journey Model',
      engine: 'litert',
      fileName: 'settings-journey.litertlm',
    });

    const rtl = requireRTL();
    const view = renderProductionApp(rtl);
    const openTextGenerationSettings = async () => {
      if (!view.queryByTestId('setting-liteRTTemperature-value')) {
        rtl.fireEvent.press(view.getByText('TEXT GENERATION'));
      }
      return view.findByTestId('setting-liteRTTemperature-value');
    };

    rtl.fireEvent.press(await view.findByTestId('model-summary-text-open'));
    rtl.fireEvent.press(
      await view.findByTestId('text-model-row-settings-journey-model'),
    );
    rtl.fireEvent.press(await view.findByTestId('new-chat-button'));
    expect(await view.findByTestId('chat-screen')).toBeVisible();

    rtl.fireEvent.press(view.getByTestId('chat-settings-icon'));
    expect(await view.findByText('Chat Settings')).toBeVisible();
    await openTextGenerationSettings();

    expect(
      view.getByTestId('setting-liteRTTemperature-value'),
    ).toHaveTextContent('0.70');
    rtl.fireEvent.press(
      view.getByTestId('setting-liteRTTemperature-value-button'),
    );
    const temperatureInput = view.getByTestId(
      'setting-liteRTTemperature-input',
    );
    rtl.fireEvent.changeText(temperatureInput, '0.33');
    rtl.fireEvent(temperatureInput, 'submitEditing');

    await rtl.waitFor(() =>
      expect(
        view.getByTestId('setting-liteRTTemperature-value'),
      ).toHaveTextContent('0.33'),
    );
    rtl.fireEvent.press(view.getByTestId('app-sheet-close'));

    boundary.litert.scriptTurnFromTemperature(temperature => ({
      content: `Temperature ${temperature.toFixed(2)} applied.`,
    }));
    rtl.fireEvent.changeText(
      await view.findByTestId('chat-input'),
      'Use my generation setting',
    );
    rtl.fireEvent.press(await view.findByTestId('send-button'));
    expect(await view.findByText('Temperature 0.33 applied.')).toBeVisible();
    expect(view.queryByTestId('model-failure-text')).toBeNull();

    rtl.fireEvent.press(view.getByTestId('chat-settings-icon'));
    expect(await view.findByText('Chat Settings')).toBeVisible();
    await openTextGenerationSettings();
    expect(
      view.getByTestId('setting-liteRTTemperature-value'),
    ).toHaveTextContent('0.33');

    rtl.fireEvent.press(view.getByText('Reset to Defaults'));

    await rtl.waitFor(() =>
      expect(
        view.getByTestId('setting-liteRTTemperature-value'),
      ).toHaveTextContent('0.70'),
    );

    rtl.fireEvent.press(view.getByTestId('app-sheet-close'));
    boundary.litert.scriptTurnFromTemperature(temperature => ({
      content: `Temperature ${temperature.toFixed(2)} applied.`,
    }));
    rtl.fireEvent.changeText(
      await view.findByTestId('chat-input'),
      'Use the reset generation setting',
    );
    rtl.fireEvent.press(await view.findByTestId('send-button'));
    expect(await view.findByText('Temperature 0.70 applied.')).toBeVisible();
    expect(view.queryByTestId('model-failure-text')).toBeNull();
  });
});
