/**
 * @format
 */

// Spec-compliant global URL — RN's built-in mangles paths (adds trailing slashes),
// which breaks the MCP SDK's OAuth discovery. Must load before any network/OAuth code.
import 'react-native-url-polyfill/auto';
// Hermes does not provide TextEncoder/TextDecoder. Sync's proven EasyShare
// protocol requires both before the shared wire codec is loaded.
import 'text-encoding-polyfill';
// Hermes does not expose Web Crypto on every supported OS version. Install the
// secure getRandomValues polyfill before stores create persisted sync identities.
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
