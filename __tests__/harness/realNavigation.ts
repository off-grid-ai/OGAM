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

/**
 * The screen as the top of a real stack: a previous screen sits under it (testID `previous-screen`), and
 * each name in `to` is a route it can navigate to, standing in for that screen (testID `route-<name>`,
 * its params as the text). Going back shows the previous screen; navigating shows the destination. The
 * test reads where the person ended up instead of spying on navigate / goBack.
 */
export function inStack(
  element: React.ReactElement,
  opts: { params?: Record<string, unknown>; to?: string[] } = {},
): React.ReactElement {
  const { NavigationContainer } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { Text } = require('react-native');
  const Stack = createNativeStackNavigator();
  const standIn = (name: string) => ({ route }: { route: { params?: unknown } }) =>
    React.createElement(Text, { testID: `route-${name}` }, JSON.stringify(route.params ?? {}));
  return React.createElement(
    NavigationContainer,
    { initialState: { index: 1, routes: [{ name: 'Previous' }, { name: 'Host', params: opts.params }] } },
    React.createElement(
      Stack.Navigator,
      { screenOptions: { headerShown: false } },
      React.createElement(Stack.Screen, { name: 'Previous', children: () => React.createElement(Text, { testID: 'previous-screen' }, 'previous') }),
      React.createElement(Stack.Screen, { name: 'Host', children: () => element }),
      ...(opts.to ?? []).map(name => React.createElement(Stack.Screen, { key: name, name, component: standIn(name) })),
    ),
  );
}
