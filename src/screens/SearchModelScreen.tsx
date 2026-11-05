import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmbeddingModelsTab } from './ModelsScreen/EmbeddingModelsTab';
import { useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';

/**
 * Settings › Search Model as its own page, so Back returns to Settings. The row used to switch to the
 * Models tab, and Back then had nowhere to go (every view is a route). It shows the same picker the
 * Models › Search tab shows; the choice still lives in one place.
 */
export const SearchModelScreen: React.FC = () => {
  const navigation = useNavigation();
  const styles = useThemedStyles(createStyles);
  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="search-model-screen">
      <ScreenHeader title="Document search" onBack={() => navigation.goBack()} />
      <EmbeddingModelsTab />
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => ({
  container: { flex: 1, backgroundColor: colors.background },
});
