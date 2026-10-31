/**
 * Real navigation for a screen a test renders on its own.
 *
 * The test file calls `jest.unmock('@react-navigation/native')`, and the screen is rendered as the one screen
 * of a real React Navigation stack, so useNavigation, useRoute, useFocusEffect and navigate are the library's
 * own. Nothing of ours is faked. `params` are the route's params, as a navigate to the screen hands them.
 */
import React from 'react';

export function withNavigator(element: React.ReactElement, params?: Record<string, unknown>): React.ReactElement {
  const { NavigationContainer } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const Stack = createNativeStackNavigator();
  return React.createElement(
    NavigationContainer,
    null,
    React.createElement(
      Stack.Navigator,
      { screenOptions: { headerShown: false } },
      React.createElement(Stack.Screen, { name: 'Host', initialParams: params, children: () => element }),
    ),
  );
}
