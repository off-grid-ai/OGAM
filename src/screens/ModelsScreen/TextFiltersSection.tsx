import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useThemedStyles } from '../../theme';
import { MODEL_ORGS } from '../../constants';
import { createStyles } from './styles';
import {
  FilterState,
  FilterDimension,
  ModelTypeFilter,
  CredibilityFilter,
  SizeFilter,
} from './types';
import {
  CREDIBILITY_OPTIONS,
  MODEL_TYPE_OPTIONS,
  SIZE_OPTIONS,
  QUANT_OPTIONS,
} from './constants';

interface Props {
  filterState: FilterState;
  hasActiveFilters: boolean;
  clearFilters: () => void;
  toggleFilterDimension: (dim: FilterDimension) => void;
  toggleOrg: (key: string) => void;
  setTypeFilter: (type: ModelTypeFilter) => void;
  setSourceFilter: (source: CredibilityFilter) => void;
  setSizeFilter: (size: SizeFilter) => void;
  setQuantFilter: (quant: string) => void;
}

export const TextFiltersSection: React.FC<Props> = ({
  filterState,
  hasActiveFilters,
  clearFilters,
  toggleFilterDimension,
  toggleOrg,
  setTypeFilter,
  setSourceFilter,
  setSizeFilter,
  setQuantFilter,
}) => {
  const styles = useThemedStyles(createStyles);

  const renderPill = ({
    label,
    isActive,
    dim,
    badge,
  }: {
    label: string;
    isActive: boolean;
    dim: FilterDimension;
    badge?: number;
  }) => (
    <TouchableOpacity
      style={[styles.filterPill, isActive && styles.filterPillActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      testID={`text-filter-${dim}`}
      onPress={() => toggleFilterDimension(dim)}
    >
      <Text
        style={[styles.filterPillText, isActive && styles.filterPillTextActive]}
      >
        {label} {filterState.expandedDimension === dim ? '\u25B4' : '\u25BE'}
      </Text>
      {badge != null && badge > 0 && (
        <View style={styles.filterCountBadge}>
          <Text style={styles.filterCountText}>{badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const typeLabel =
    filterState.type === 'all'
      ? 'Type'
      : MODEL_TYPE_OPTIONS.find(o => o.key === filterState.type)?.label ??
        'Type';
  const sourceLabel =
    filterState.source === 'all'
      ? 'Source'
      : CREDIBILITY_OPTIONS.find(o => o.key === filterState.source)?.label ??
        'Source';
  const sizeLabel =
    filterState.size === 'all'
      ? 'Size'
      : SIZE_OPTIONS.find(o => o.key === filterState.size)?.label ?? 'Size';
  const quantLabel = filterState.quant === 'all' ? 'Quant' : filterState.quant;

  return (
    <View style={styles.filterBar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterPillRow}
        keyboardShouldPersistTaps="handled"
      >
        {renderPill({
          label: 'Org',
          isActive: filterState.orgs.length > 0,
          dim: 'org',
          badge: filterState.orgs.length,
        })}
        {renderPill({
          label: typeLabel,
          isActive: filterState.type !== 'all',
          dim: 'type',
        })}
        {renderPill({
          label: sourceLabel,
          isActive: filterState.source !== 'all',
          dim: 'source',
        })}
        {renderPill({
          label: sizeLabel,
          isActive: filterState.size !== 'all',
          dim: 'size',
        })}
        {renderPill({
          label: quantLabel,
          isActive: filterState.quant !== 'all',
          dim: 'quant',
        })}
        {hasActiveFilters && (
          <TouchableOpacity
            style={styles.clearFiltersButton}
            onPress={clearFilters}
          >
            <Text style={styles.clearFiltersText}>Clear</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {filterState.expandedDimension === 'org' && (
        <View style={styles.filterExpandedContent}>
          <View style={styles.filterChipWrap}>
            {MODEL_ORGS.map(org => (
              <TouchableOpacity
                key={org.key}
                style={[
                  styles.filterChip,
                  filterState.orgs.includes(org.key) && styles.filterChipActive,
                ]}
                onPress={() => toggleOrg(org.key)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    filterState.orgs.includes(org.key) &&
                      styles.filterChipTextActive,
                  ]}
                >
                  {org.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {filterState.expandedDimension === 'type' && (
        <View style={styles.filterExpandedContent}>
          <View style={styles.filterChipWrap}>
            {MODEL_TYPE_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{
                  selected: filterState.type === option.key,
                }}
                testID={`text-filter-type-${option.key}`}
                style={[
                  styles.filterChip,
                  filterState.type === option.key && styles.filterChipActive,
                ]}
                onPress={() => setTypeFilter(option.key)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    filterState.type === option.key &&
                      styles.filterChipTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {filterState.expandedDimension === 'source' && (
        <View style={styles.filterExpandedContent}>
          <View style={styles.filterChipWrap}>
            {CREDIBILITY_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.key}
                style={[
                  styles.filterChip,
                  filterState.source === option.key && styles.filterChipActive,
                  filterState.source === option.key && option.color
                    ? {
                        backgroundColor: `${option.color}25`,
                        borderColor: option.color,
                      }
                    : undefined,
                ]}
                onPress={() => setSourceFilter(option.key)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    filterState.source === option.key &&
                      styles.filterChipTextActive,
                    filterState.source === option.key && option.color
                      ? { color: option.color }
                      : undefined,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {filterState.expandedDimension === 'size' && (
        <View style={styles.filterExpandedContent}>
          <View style={styles.filterChipWrap}>
            {SIZE_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{
                  selected: filterState.size === option.key,
                }}
                testID={`text-filter-size-${option.key}`}
                style={[
                  styles.filterChip,
                  filterState.size === option.key && styles.filterChipActive,
                ]}
                onPress={() => setSizeFilter(option.key)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    filterState.size === option.key &&
                      styles.filterChipTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {filterState.expandedDimension === 'quant' && (
        <View style={styles.filterExpandedContent}>
          <View style={styles.filterChipWrap}>
            {QUANT_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.key}
                style={[
                  styles.filterChip,
                  filterState.quant === option.key && styles.filterChipActive,
                ]}
                onPress={() => setQuantFilter(option.key)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    filterState.quant === option.key &&
                      styles.filterChipTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  );
};
