/**
 * Shared types for the HomeScreen hooks. They live here (not in useHomeScreen) so the sub-hooks
 * (useModelLoading, useLANDiscovery, useRemoteModelHandlers) can import them WITHOUT importing
 * useHomeScreen — which imports those sub-hooks back, forming a cycle. useHomeScreen re-exports
 * these for existing external importers.
 */
import { CompositeNavigationProp } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MainTabParamList, RootStackParamList } from '../../../navigation/types';

export type HomeScreenNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'HomeTab'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export type ModelPickerType = 'text' | 'image' | null;

export type LoadingState = {
  isLoading: boolean;
  type: 'text' | 'image' | null;
  modelName: string | null;
};
