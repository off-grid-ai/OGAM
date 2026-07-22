import { renderFreshApp } from '../../harness/appJourney';

describe('fresh-install onboarding journey', () => {
  it('launches into onboarding with no persisted app state', async () => {
    const { view } = await renderFreshApp();

    expect(view.getByTestId('onboarding-screen')).toBeTruthy();
    expect(view.getByTestId('onboarding-next')).toBeTruthy();
  });

  it('completes onboarding and reaches Home through the real navigation stack', async () => {
    const { rtl, view } = await renderFreshApp();
    const { Dimensions } = require('react-native');
    const width = Dimensions.get('window').width;
    const slides = view.getByTestId('onboarding-slides');

    for (const [index, keyword] of ['MAGIC', 'CREATE', 'READY'].entries()) {
      rtl.fireEvent.press(view.getByTestId('onboarding-next'));
      rtl.fireEvent(slides, 'momentumScrollEnd', {
        nativeEvent: { contentOffset: { x: (index + 1) * width } },
      });
      await rtl.waitFor(() => expect(view.getByText(keyword)).toBeTruthy());
    }

    expect(view.getByText('Get Started')).toBeTruthy();
    rtl.fireEvent.press(view.getByTestId('onboarding-next'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('model-download-screen')).toBeTruthy();
    });

    rtl.fireEvent.press(view.getByTestId('model-download-skip'));
    await rtl.waitFor(() => {
      expect(view.getByTestId('home-screen')).toBeTruthy();
    });
    expect(view.queryByTestId('onboarding-screen')).toBeNull();
  });
});
