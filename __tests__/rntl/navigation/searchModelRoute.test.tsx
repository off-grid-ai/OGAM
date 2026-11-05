/**
 * Settings › Search Model is a page of its own: the row pushes it, and its Back returns to Settings.
 * It used to switch to the Models tab, which left Back with nowhere to go (every view is a route).
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { withNavigatorRoutes } from '../../harness/realNavigation';

jest.unmock('@react-navigation/native');

describe('Search Model route', () => {
  it('the Settings row opens the Search Model page, not the Models tab', async () => {
    const { SettingsScreen } = require('../../../src/screens/SettingsScreen');
    const view = render(withNavigatorRoutes(<SettingsScreen />, { destinations: ['SearchModel', 'ModelsTab'] }));

    fireEvent.press(await waitFor(() => view.getByTestId('open-search-model')));

    await waitFor(() => expect(view.queryByTestId('route-SearchModel')).not.toBeNull());
    expect(view.queryByTestId('route-ModelsTab')).toBeNull();
  });

  it('the page’s Back returns to where it was opened from', async () => {
    const { SearchModelScreen } = require('../../../src/screens/SearchModelScreen');
    const view = render(withNavigatorRoutes(<SearchModelScreen />, { openedFrom: 'SettingsTab' }));

    fireEvent.press(await waitFor(() => view.getByLabelText('Back')));

    await waitFor(() => expect(view.queryByTestId('route-SettingsTab')).not.toBeNull());
  });
});
