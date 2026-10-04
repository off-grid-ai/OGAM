import {createNavigationContainerRef} from '@react-navigation/native';
import type {RootStackParamList} from './types';

/** The one root navigation reference used by the application surface. */
export const appNavigationRef =
  createNavigationContainerRef<RootStackParamList>();
