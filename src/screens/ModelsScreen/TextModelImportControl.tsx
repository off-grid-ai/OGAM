import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import type { createStyles } from './styles';

interface Props {
  colors: { primary: string; textMuted: string };
  styles: ReturnType<typeof createStyles>;
  isImporting: boolean;
  importProgress: { fraction: number; fileName: string } | null;
  onImport: () => void;
}

/** Text-only placement for the existing text/vision import workflow. */
const TextModelImportButton: React.FC<Omit<Props, 'importProgress'>> = ({
  colors,
  styles,
  isImporting,
  onImport,
}) => (
  <TouchableOpacity
    style={[styles.filterToggle, isImporting && styles.filterToggleActive]}
    onPress={onImport}
    disabled={isImporting}
    accessibilityLabel="Import a local text or vision model"
    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    testID="import-local-model"
  >
    <Icon
      name="upload"
      size={14}
      color={isImporting ? colors.primary : colors.textMuted}
    />
  </TouchableOpacity>
);

interface ToolbarProps extends Omit<Props, 'importProgress'> {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearch: () => void;
  sortIcon: string;
  sortActive: boolean;
  sortChanged: boolean;
  filterActive: boolean;
  filterChanged: boolean;
  onToggleSort: () => void;
  onToggleFilters: () => void;
  showImport: boolean;
}

export const TextModelsToolbar: React.FC<ToolbarProps> = ({
  colors, styles, searchQuery, onSearchQueryChange, onSearch,
  sortIcon, sortActive, sortChanged, filterActive, filterChanged,
  onToggleSort, onToggleFilters, showImport, isImporting, onImport,
}) => (
  <View style={styles.searchContainer}>
    <TextInput
      style={styles.searchInput}
      placeholder="Search Hugging Face models..."
      placeholderTextColor={colors.textMuted}
      value={searchQuery}
      onChangeText={onSearchQueryChange}
      onSubmitEditing={onSearch}
      returnKeyType="search"
      testID="search-input"
    />
    <TouchableOpacity
      style={[styles.filterToggle, sortActive && styles.filterToggleActive]}
      onPress={onToggleSort}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      testID="sort-pill"
    >
      <Icon name={sortIcon} size={14} color={sortActive ? colors.primary : colors.textMuted} />
      {sortChanged && <View style={styles.filterDot} />}
    </TouchableOpacity>
    <TouchableOpacity
      style={[styles.filterToggle, filterActive && styles.filterToggleActive]}
      onPress={onToggleFilters}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      testID="text-filter-toggle"
    >
      <Icon name="sliders" size={14} color={filterActive ? colors.primary : colors.textMuted} />
      {filterChanged && <View style={styles.filterDot} />}
    </TouchableOpacity>
    {showImport && (
      <TextModelImportButton
        colors={colors}
        styles={styles}
        isImporting={isImporting}
        onImport={onImport}
      />
    )}
  </View>
);

export const TextModelImportProgress: React.FC<
  Pick<Props, 'colors' | 'styles' | 'importProgress'>
> = ({ colors, styles, importProgress }) => importProgress ? (
  <View style={styles.importProgressCard}>
    <View style={styles.importProgressHeader}>
      <Icon name="file" size={18} color={colors.primary} />
      <Text style={styles.importProgressText} numberOfLines={1}>
        Importing {importProgress.fileName}
      </Text>
    </View>
    <View style={styles.imageProgressBar}>
      <View
        style={[
          styles.imageProgressFill,
          { width: `${Math.round(importProgress.fraction * 100)}%` },
        ]}
      />
    </View>
    <Text style={styles.importProgressPercent}>
      {Math.round(importProgress.fraction * 100)}%
    </Text>
  </View>
) : null;
