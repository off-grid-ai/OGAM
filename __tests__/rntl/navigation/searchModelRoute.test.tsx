/**
 * Settings › Document search opens Models on its Documents tab, the one home of document search
 * (hand test 84: a second Search Model page copied it). The Search Model page, where it is still
 * opened, keeps a Back that returns to where it was opened from.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { withNavigatorRoutes } from '../../harness/realNavigation';

jest.unmock('@react-navigation/native');

describe('Search Model route', () => {
  it('the Settings row opens Models on its Documents tab, the one home of document search', async () => {
    const { SettingsScreen } = require('../../../src/screens/SettingsScreen');
    const { NavigationContainer } = require('@react-navigation/native');
    const { createNativeStackNavigator } = require('@react-navigation/native-stack');
    const { Text } = require('react-native');
    const Stack = createNativeStackNavigator();
    /** Where a tap lands: the route's name and the params it was handed. */
    const Landing = ({ route }: { route: { name: string; params?: object } }) => (
      <Text testID={`route-${route.name}`}>{JSON.stringify(route.params ?? {})}</Text>
    );
    const view = render(
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="ModelsTab" component={Landing} />
          <Stack.Screen name="SearchModel" component={Landing} />
        </Stack.Navigator>
      </NavigationContainer>,
    );

    fireEvent.press(await waitFor(() => view.getByTestId('open-search-model')));

    const models = await waitFor(() => view.getByTestId('route-ModelsTab'));
    expect(JSON.parse(String(models.props.children))).toEqual({ initialTab: 'embedding' });
    expect(view.queryByTestId('route-SearchModel')).toBeNull();
  });

  it('the page’s Back returns to where it was opened from', async () => {
    const { SearchModelScreen } = require('../../../src/screens/SearchModelScreen');
    const view = render(withNavigatorRoutes(<SearchModelScreen />, { openedFrom: 'SettingsTab' }));

    fireEvent.press(await waitFor(() => view.getByLabelText('Back')));

    await waitFor(() => expect(view.queryByTestId('route-SettingsTab')).not.toBeNull());
  });
});
