import React, { useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRoute, RouteProp } from '@react-navigation/native';
import { MainTabParamList } from '../../navigation/types';
import Icon from 'react-native-vector-icons/Feather';
import { CustomAlert, hideAlert } from '../../components/CustomAlert';
import { SPACING } from '../../constants';
import { RECOMMENDED_MODELS } from '@offgrid/application';
import { useTheme, useThemedStyles } from '../../theme';
import { useModelsScreen } from './useModelsScreen';
import { createStyles } from './styles';
import { TextModelsTab } from './TextModelsTab';
import { ImageModelsTab } from './ImageModelsTab';
import { VoiceModelsUpsell } from '../../components/models/VoiceModelsUpsell';
import { TranscriptionModelsTab } from './TranscriptionModelsTab';
import { useSlot, SLOTS } from '../../bootstrap/slotRegistry';
import type { ModelTab } from './types';
import { ScreenHeader } from '../../components/ScreenHeader';

const MODEL_TABS: ReadonlyArray<{ key: ModelTab; label: string; testID?: string }> = [
  { key: 'text', label: 'Text' },
  { key: 'image', label: 'Image' },
  { key: 'voice', label: 'Voice', testID: 'voice-models-tab' },
  { key: 'transcription', label: 'Speech', testID: 'transcription-models-tab' },
];

interface ModelsScreenProps {
  embedded?: boolean;
}

const ScreenFrame: React.FC<{
  embedded: boolean;
  styles: ReturnType<typeof createStyles>;
  children: React.ReactNode;
}> = ({ embedded, styles, children }) =>
  embedded ? (
    <View style={[styles.container, embeddedStyles.container]} testID="embedded-models-screen">{children}</View>
  ) : (
    <SafeAreaView style={styles.container} edges={['top']} testID="models-screen">{children}</SafeAreaView>
  );

const HideWhenEmbedded: React.FC<{ embedded: boolean; children: React.ReactNode }> = ({ embedded, children }) => (
  <View style={embedded ? collapsedStyle.hidden : undefined}>{children}</View>
);

export const ModelsScreen: React.FC<ModelsScreenProps> = ({ embedded = false }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const vm = useModelsScreen();
  // Pro fills this slot with the real voice-models panel (engine + downloads).
  // The Voice tab always renders; when the slot is empty (free / non-pro) we
  // show an upsell so users can see what Pro adds.
  const VoiceModelsPanel = useSlot(SLOTS.modelsScreenVoiceTab);
  const route = useRoute<RouteProp<MainTabParamList, 'ModelsTab'>>();

  // Reset to model list view when tab loses focus (e.g. user switches away)
  // vm.setSelectedModel / vm.setModelFiles are useState setters — stable across renders.
  // Do NOT use [vm] as dependency — vm is a new object every render, which would
  // cause the cleanup to fire on every re-render and immediately undo model selection.
  const didAutoSelect = useRef(false);
  useFocusEffect(
    useCallback(() => {
      const { initialTab, repairModelId, initialSearchQuery } = route.params ?? {};
      if (initialTab) vm.setActiveTab(initialTab);
      // Deep-link from the chat "get an accelerated model" banner: land on the Text
      // tab with the HF search prefilled (the debounced search in useTextModels fires
      // on the query change). Guarded so it seeds once per navigation.
      if (initialSearchQuery && !didAutoSelect.current) {
        vm.setActiveTab('text');
        vm.setSearchQuery(initialSearchQuery);
      }
      if (repairModelId && !didAutoSelect.current) {
        didAutoSelect.current = true;
        const match = RECOMMENDED_MODELS.find(m => m.id === repairModelId);
        if (match) vm.handleSelectModel({ id: match.id, name: match.name, author: match.id.split('/')[0], description: match.description, modelType: match.type, paramCount: match.params, minRamGB: match.minRam, downloads: 0, likes: 0, tags: [], lastModified: '', files: [] });
      }
      return () => {
        didAutoSelect.current = false;
        vm.setSelectedModel(null);
        vm.setModelFiles([]);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [route.params?.initialTab, route.params?.repairModelId]),
  );

  const isShowingDetail = vm.activeTab === 'text' && vm.selectedModel !== null;

  const content = (
    <>
      {/* Collapse header/import/tabs when showing model detail — detail has its own header.
           Use height:0 + overflow:hidden instead of unmounting so AttachStep components
           stay mounted and measured. */}
      <View style={isShowingDetail ? collapsedStyle.hidden : undefined}>
        {/* Header */}
        <HideWhenEmbedded embedded={embedded}>
          <ScreenHeader
            title="Models"
            variant="tab"
            right={
              <TouchableOpacity
              style={styles.downloadManagerButton}
              hitSlop={SPACING.md}
              onPress={() => vm.navigation.navigate('DownloadManager')}
              testID="downloads-icon"
            >
              <Icon name="download" size={20} color={colors.text} />
              {vm.downloadBadgeCount > 0 && (
                <View style={styles.downloadBadge}>
                  <Text testID="downloads-badge-count" style={styles.downloadBadgeText}>{vm.downloadBadgeCount}</Text>
                </View>
              )}
              </TouchableOpacity>
            }
          />
        </HideWhenEmbedded>

        {/* Tab Bar (horizontally scrollable — four tabs don't fit on a phone) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabBarFrame}
          contentContainerStyle={styles.tabBar}
        >
          {MODEL_TABS.map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={styles.tabItem}
              testID={tab.testID}
              onPress={() => vm.setActiveTab(tab.key)}
            >
              <Text style={[styles.tabText, vm.activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
              {vm.activeTab === tab.key && <View style={styles.tabIndicator} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Text Models Tab */}
      {vm.activeTab === 'text' && (
        <TextModelsTab
          onboarding={embedded}
          searchQuery={vm.searchQuery}
          setSearchQuery={vm.setSearchQuery}
          isLoading={vm.isLoading}
          isRefreshing={vm.isRefreshing}
          hasSearched={vm.hasSearched}
          selectedModel={vm.selectedModel}
          setSelectedModel={vm.setSelectedModel}
          modelFiles={vm.modelFiles}
          setModelFiles={vm.setModelFiles}
          isLoadingFiles={vm.isLoadingFiles}
          filterState={vm.filterState}
          textFiltersVisible={vm.textFiltersVisible}
          setTextFiltersVisible={vm.setTextFiltersVisible}
          filteredResults={vm.filteredResults}
          recommendedAsModelInfo={vm.recommendedAsModelInfo}
          trendingAsModelInfo={vm.trendingAsModelInfo}
          ramGB={vm.ramGB}
          deviceRecommendation={vm.deviceRecommendation}
          hasActiveFilters={vm.hasActiveFilters}
          downloadedModels={vm.downloadedModels}
          alertState={vm.alertState}
          setAlertState={vm.setAlertState}
          focusTrigger={vm.focusTrigger}
          handleSearch={vm.handleSearch}
          handleRefresh={vm.handleRefresh}
          handleSelectModel={vm.handleSelectModel}
          handleDownload={vm.handleDownload}
          handleRepairMmProj={vm.handleRepairMmProj}
          handleCancelDownload={vm.handleCancelDownload}
          handleDeleteModel={vm.handleDeleteModel}
          clearFilters={vm.clearFilters}
          toggleFilterDimension={vm.toggleFilterDimension}
          toggleOrg={vm.toggleOrg}
          setTypeFilter={vm.setTypeFilter}
          setSourceFilter={vm.setSourceFilter}
          setSizeFilter={vm.setSizeFilter}
          setQuantFilter={vm.setQuantFilter}
          setSortOption={vm.setSortOption}
          isModelDownloaded={vm.isModelDownloaded}
          getDownloadedModel={vm.getDownloadedModel}
          isRepairingVisionModel={vm.isRepairingVisionModel}
          isImporting={vm.isImporting}
          importProgress={vm.importProgress}
          handleImportLocalModel={vm.handleImportLocalModel}
        />
      )}

      {/* Image Models Tab */}
      {vm.activeTab === 'image' && (
        <ImageModelsTab
          imageSearchQuery={vm.imageSearchQuery}
          setImageSearchQuery={vm.setImageSearchQuery}
          hfModelsLoading={vm.hfModelsLoading}
          hfModelsError={vm.hfModelsError}
          filteredHFModels={vm.filteredHFModels}
          availableHFModels={vm.availableHFModels}
          backendFilter={vm.backendFilter}
          setBackendFilter={vm.setBackendFilter}
          styleFilter={vm.styleFilter}
          setStyleFilter={vm.setStyleFilter}
          sdVersionFilter={vm.sdVersionFilter}
          setSdVersionFilter={vm.setSdVersionFilter}
          imageFilterExpanded={vm.imageFilterExpanded}
          setImageFilterExpanded={vm.setImageFilterExpanded}
          imageFiltersVisible={vm.imageFiltersVisible}
          setImageFiltersVisible={vm.setImageFiltersVisible}
          hasActiveImageFilters={vm.hasActiveImageFilters}
          showRecommendedOnly={vm.showRecommendedOnly}
          setShowRecommendedOnly={vm.setShowRecommendedOnly}
          showRecHint={vm.showRecHint}
          setShowRecHint={vm.setShowRecHint}
          imageRec={vm.imageRec}
          ramGB={vm.ramGB}
          imageRecommendation={vm.imageRecommendation}
          handleDownloadImageModel={vm.handleDownloadImageModel}
          handleCancelImageDownload={vm.handleCancelImageDownload}
          loadHFModels={vm.loadHFModels}
          clearImageFilters={vm.clearImageFilters}
          setUserChangedBackendFilter={vm.setUserChangedBackendFilter}
          isRecommendedModel={vm.isRecommendedModel}
          setAlertState={vm.setAlertState}
          downloadedImageModels={vm.downloadedImageModels}
        />
      )}

      {/* Voice Models Tab: pro panel when registered, otherwise an upsell. */}
      {vm.activeTab === 'voice' && (
        VoiceModelsPanel
          ? <VoiceModelsPanel />
          : <VoiceModelsUpsell onGetPro={() => vm.navigation.navigate('ProDetail')} />
      )}

      {/* Transcription Models Tab (speech-to-text, core). */}
      {vm.activeTab === 'transcription' && (
        <TranscriptionModelsTab
          showLanguageSelector={!embedded}
        />
      )}

      <CustomAlert {...vm.alertState} onClose={() => vm.setAlertState(hideAlert())} />
    </>
  );

  return <ScreenFrame embedded={embedded} styles={styles}>{content}</ScreenFrame>;
};

const collapsedStyle = StyleSheet.create({
  hidden: { height: 0, overflow: 'hidden' },
});

const embeddedStyles = StyleSheet.create({
  container: { marginHorizontal: -SPACING.md },
});
