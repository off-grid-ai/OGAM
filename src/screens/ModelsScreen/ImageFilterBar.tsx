import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useThemedStyles } from '../../theme';
import { SPACING } from '../../constants';
import { createStyles } from './styles';
import { BackendFilter, ImageFilterDimension } from './types';
import { BACKEND_OPTIONS, SD_VERSION_OPTIONS, STYLE_OPTIONS } from './constants';
import { imageBackendLabel } from '../../utils/imageBackend';

interface Props {
  backendFilter: BackendFilter;
  setBackendFilter: (f: BackendFilter) => void;
  styleFilter: string;
  setStyleFilter: (f: string) => void;
  sdVersionFilter: string;
  setSdVersionFilter: (f: string) => void;
  imageFilterExpanded: ImageFilterDimension;
  setImageFilterExpanded: (d: ImageFilterDimension | ((prev: ImageFilterDimension) => ImageFilterDimension)) => void;
  hasActiveImageFilters: boolean;
  clearImageFilters: () => void;
  setUserChangedBackendFilter: (v: boolean) => void;
}

function getBackendLabel(filter: BackendFilter): string {
  return imageBackendLabel(filter, 'Backend');
}

function getSdLabel(filter: string): string {
  return filter === 'all' ? 'Version' : (SD_VERSION_OPTIONS.find(o => o.key === filter)?.label ?? 'Version');
}

function getStyleLabel(filter: string): string {
  return filter === 'all' ? 'Style' : (STYLE_OPTIONS.find(o => o.key === filter)?.label ?? 'Style');
}

interface ExpandedSectionProps {
  imageFilterExpanded: ImageFilterDimension;
  backendFilter: BackendFilter;
  sdVersionFilter: string;
  styleFilter: string;
  setBackendFilter: (f: BackendFilter) => void;
  setSdVersionFilter: (f: string) => void;
  setStyleFilter: (f: string) => void;
  setImageFilterExpanded: (d: ImageFilterDimension | ((prev: ImageFilterDimension) => ImageFilterDimension)) => void;
  setUserChangedBackendFilter: (v: boolean) => void;
}

const FilterExpandedSection: React.FC<ExpandedSectionProps> = ({
  imageFilterExpanded, backendFilter, sdVersionFilter, styleFilter,
  setBackendFilter, setSdVersionFilter, setStyleFilter,
  setImageFilterExpanded, setUserChangedBackendFilter,
}) => {
  const styles = useThemedStyles(createStyles);

  if (imageFilterExpanded === 'backend' && Platform.OS !== 'ios') {
    return (
      <View style={styles.filterExpandedContent}>
        <View style={styles.filterChipWrap}>
          {BACKEND_OPTIONS.map(option => (
            <TouchableOpacity
              key={option.key}
              style={[styles.filterChip, backendFilter === option.key && styles.filterChipActive]}
              onPress={() => { setBackendFilter(option.key); setUserChangedBackendFilter(true); setImageFilterExpanded(null); }}
            >
              <Text style={[styles.filterChipText, backendFilter === option.key && styles.filterChipTextActive]}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  if (imageFilterExpanded === 'sdVersion' && Platform.OS === 'ios') {
    return (
      <View style={styles.filterExpandedContent}>
        <View style={styles.filterChipWrap}>
          {SD_VERSION_OPTIONS.map(option => (
            <TouchableOpacity
              key={option.key}
              style={[styles.filterChip, sdVersionFilter === option.key && styles.filterChipActive]}
              onPress={() => { setSdVersionFilter(option.key); setImageFilterExpanded(null); }}
            >
              <Text style={[styles.filterChipText, sdVersionFilter === option.key && styles.filterChipTextActive]}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  if (imageFilterExpanded === 'style' && Platform.OS !== 'ios') {
    return (
      <View style={styles.filterExpandedContent}>
        <View style={styles.filterChipWrap}>
          {STYLE_OPTIONS.map(option => (
            <TouchableOpacity
              key={option.key}
              style={[styles.filterChip, styleFilter === option.key && styles.filterChipActive]}
              onPress={() => { setStyleFilter(option.key); setImageFilterExpanded(null); }}
            >
              <Text style={[styles.filterChipText, styleFilter === option.key && styles.filterChipTextActive]}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  return null;
};

export const ImageFilterBar: React.FC<Props> = ({
  backendFilter, setBackendFilter,
  styleFilter, setStyleFilter,
  sdVersionFilter, setSdVersionFilter,
  imageFilterExpanded, setImageFilterExpanded,
  hasActiveImageFilters, clearImageFilters,
  setUserChangedBackendFilter,
}) => {
  const styles = useThemedStyles(createStyles);

  const backendLabel = getBackendLabel(backendFilter);
  const sdLabel = getSdLabel(sdVersionFilter);
  const styleLabel = getStyleLabel(styleFilter);

  return (
    <View style={[styles.filterBar, { marginHorizontal: -SPACING.lg }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterPillRow} keyboardShouldPersistTaps="handled">
        {Platform.OS !== 'ios' && (
          <TouchableOpacity
            style={[styles.filterPill, backendFilter !== 'all' && styles.filterPillActive]}
            onPress={() => setImageFilterExpanded(prev => prev === 'backend' ? null : 'backend')}
          >
            <Text style={[styles.filterPillText, backendFilter !== 'all' && styles.filterPillTextActive]}>
              {backendLabel} {imageFilterExpanded === 'backend' ? '\u25B4' : '\u25BE'}
            </Text>
          </TouchableOpacity>
        )}
        {Platform.OS === 'ios' && (
          <TouchableOpacity
            style={[styles.filterPill, sdVersionFilter !== 'all' && styles.filterPillActive]}
            onPress={() => setImageFilterExpanded(prev => prev === 'sdVersion' ? null : 'sdVersion')}
          >
            <Text style={[styles.filterPillText, sdVersionFilter !== 'all' && styles.filterPillTextActive]}>
              {sdLabel} {imageFilterExpanded === 'sdVersion' ? '\u25B4' : '\u25BE'}
            </Text>
          </TouchableOpacity>
        )}
        {Platform.OS !== 'ios' && (
          <TouchableOpacity
            style={[styles.filterPill, styleFilter !== 'all' && styles.filterPillActive]}
            onPress={() => setImageFilterExpanded(prev => prev === 'style' ? null : 'style')}
          >
            <Text style={[styles.filterPillText, styleFilter !== 'all' && styles.filterPillTextActive]}>
              {styleLabel} {imageFilterExpanded === 'style' ? '\u25B4' : '\u25BE'}
            </Text>
          </TouchableOpacity>
        )}
        {hasActiveImageFilters && (
          <TouchableOpacity style={styles.clearFiltersButton} onPress={clearImageFilters}>
            <Text style={styles.clearFiltersText}>Clear</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <FilterExpandedSection
        imageFilterExpanded={imageFilterExpanded}
        backendFilter={backendFilter}
        sdVersionFilter={sdVersionFilter}
        styleFilter={styleFilter}
        setBackendFilter={setBackendFilter}
        setSdVersionFilter={setSdVersionFilter}
        setStyleFilter={setStyleFilter}
        setImageFilterExpanded={setImageFilterExpanded}
        setUserChangedBackendFilter={setUserChangedBackendFilter}
      />
    </View>
  );
};
