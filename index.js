/**
 * @format
 */

// Spec-compliant global URL — RN's built-in mangles paths (adds trailing slashes),
// which breaks the MCP SDK's OAuth discovery. Must load before any network/OAuth code.
import 'react-native-url-polyfill/auto';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
