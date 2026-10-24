import { CompositeNavigationProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { ModelSource } from '../../types';
import { RootStackParamList, MainTabParamList } from '../../navigation/types';
export type { ImageModelDescriptor } from '../../services/imageModelDownloadTypes';

export type BackendFilter = 'all' | 'mnn' | 'qnn' | 'coreml' | 'sd';

export type CredibilityFilter = 'all' | ModelSource;
export type ModelTypeFilter = 'all' | 'text' | 'vision' | 'code' | 'image-gen';
export type SizeFilter = 'all' | 'tiny' | 'small' | 'medium' | 'large';
export type SortOption = 'recommended' | 'bestfit' | 'size' | 'downloads' | 'recency';
export type FilterDimension = 'org' | 'type' | 'source' | 'size' | 'quant' | 'sort' | null;
export type ImageFilterDimension = 'backend' | 'style' | 'sdVersion' | null;
export type ModelTab = 'text' | 'image' | 'video' | 'voice' | 'transcription' | 'embedding';

export interface FilterState {
  orgs: string[];
  type: ModelTypeFilter;
  source: CredibilityFilter;
  size: SizeFilter;
  quant: string;
  sort: SortOption;
  expandedDimension: FilterDimension;
}

export type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'ModelsTab'>,
  NativeStackNavigationProp<RootStackParamList>
>;
