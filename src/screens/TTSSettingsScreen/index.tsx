import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { NumericStepper } from '../../components/NumericStepper';
import { useNavigation } from '@react-navigation/native';
import { Card, Button } from '../../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';
import { useTTSStore } from '../../stores/ttsStore';
import { hardwareService } from '../../services/hardware';
import { TTS_BACKBONE_MODEL, TTS_WARN_RAM_GB, TTS_BLOCK_RAM_GB } from '../../constants/ttsModels';
import { KOKORO_VOICES, isExecutorchSupported } from '../../constants/kokoroModels';
import type { KokoroVoiceId } from '../../constants/kokoroModels';
import type { InterfaceMode } from '../../stores/ttsStore';

// ─── Sub-components ───────────────────────────────────────────────────────────

type Styles = ReturnType<typeof createStyles>;

const ProgressRow: React.FC<{
  label: string;
  sizeMB: number;
  downloaded: boolean;
  downloading: boolean;
  progress: number;
  styles: Styles;
  colors: ThemeColors;
  border?: boolean;
}> = ({ label, sizeMB, downloaded, downloading, progress, styles, colors, border }) => (
  <View>
    <View style={[styles.modelRow, border ? styles.modelRowBorder : undefined]}>
      <View style={styles.modelInfo}>
        <Text style={styles.modelName}>{label}</Text>
        <Text style={styles.modelSize}>{sizeMB} MB</Text>
      </View>
      {downloaded && <Icon name="check-circle" size={14} color={colors.primary} />}
      {downloading && <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text>}
      {!downloaded && !downloading && <Icon name="download" size={14} color={colors.textMuted} />}
    </View>
    {downloading && (
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
    )}
  </View>
);

const InterfaceModeCard: React.FC<{
  mode: InterfaceMode;
  deviceBlocked: boolean;
  areBothDownloaded: boolean;
  onModeChange: (m: InterfaceMode) => void;
  styles: Styles;
}> = ({ mode, deviceBlocked, areBothDownloaded, onModeChange, styles }) => (
  <Card style={styles.section}>
    <Text style={styles.sectionLabel}>Interface Mode</Text>
    <Text style={styles.description}>
      Audio Mode renders responses as voice notes. Chat Mode adds a play button to text bubbles.
    </Text>
    <View style={styles.modeRow}>
      {(['chat', 'audio'] as InterfaceMode[]).map((m) => {
        const active = mode === m;
        const blocked = m === 'audio' && (deviceBlocked || !areBothDownloaded);
        return (
          <TouchableOpacity
            key={m}
            style={[styles.modeChip, active && styles.modeChipActive, blocked && styles.modeChipDisabled]}
            onPress={() => onModeChange(m)}
            disabled={blocked}
          >
            <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>
              {m === 'chat' ? 'Chat' : 'Audio'}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
    {!areBothDownloaded && (
      <Text style={styles.hintText}>Download models below to enable Audio Mode.</Text>
    )}
  </Card>
);

const PlaybackCard: React.FC<{
  settings: ReturnType<typeof useTTSStore.getState>['settings'];
  onUpdate: (patch: Partial<ReturnType<typeof useTTSStore.getState>['settings']>) => void;
  colors: ThemeColors;
  styles: Styles;
}> = ({ settings, onUpdate, colors, styles }) => (
  <Card style={styles.section}>
    <Text style={styles.sectionLabel}>Playback</Text>
    <Text style={styles.sliderLabel}>Speed</Text>
    <NumericStepper
      value={settings.speed}
      min={0.5} max={2.0} step={0.1} decimals={1}
      formatValue={(v) => `${v.toFixed(1)}x`}
      onChange={(v) => onUpdate({ speed: v })}
    />
    {settings.interfaceMode === 'chat' && (
      <View style={[styles.toggleRow, styles.toggleRowBorder]}>
        <View style={styles.toggleInfo}>
          <Text style={styles.toggleTitle}>Auto-play</Text>
          <Text style={styles.toggleDesc}>Speak AI responses automatically</Text>
        </View>
        <Switch
          value={settings.autoPlay}
          onValueChange={(v) => onUpdate({ autoPlay: v })}
          trackColor={{ true: colors.primary }}
        />
      </View>
    )}
  </Card>
);

const CompatibilityCard: React.FC<{
  ramGB: number;
  deviceBlocked: boolean;
  deviceWarning: boolean;
  styles: Styles;
  colors: ThemeColors;
}> = ({ ramGB, deviceBlocked, deviceWarning, styles, colors }) => {
  if (!deviceWarning && !deviceBlocked) { return null; }
  return (
    <Card style={deviceBlocked ? styles.errorCard : styles.warningCard}>
      <View style={styles.compatRow}>
        <Icon name="alert-triangle" size={14} color={deviceBlocked ? colors.error : colors.textSecondary} />
        <Text style={[styles.compatText, deviceBlocked && styles.errorText]}>
          {deviceBlocked
            ? `TTS requires at least ${TTS_BLOCK_RAM_GB} GB RAM. Your device has ${ramGB.toFixed(1)} GB.`
            : `Your device (${ramGB.toFixed(1)} GB RAM) may run TTS but performance could be slow. 8 GB recommended.`}
        </Text>
      </View>
    </Card>
  );
};

const KokoroCard: React.FC<{
  kokoroReady: boolean;
  kokoroDownloadProgress: number;
  selectedVoiceId: KokoroVoiceId;
  isChangingVoice: boolean;
  onVoiceChange: (id: KokoroVoiceId) => void;
  styles: Styles;
  colors: ThemeColors;
}> = ({ kokoroReady, kokoroDownloadProgress, selectedVoiceId, isChangingVoice, onVoiceChange, styles, colors }) => {
  const supported = isExecutorchSupported();
  return (
    <Card style={styles.section}>
      <View style={styles.kokoroHeader}>
        <Text style={styles.sectionLabel}>Voice</Text>
        {!supported && (
          <Text style={styles.hintText}>Requires Android 13+ / iOS 17</Text>
        )}
        {supported && !kokoroReady && kokoroDownloadProgress > 0 && (
          <Text style={styles.hintText}>{Math.round(kokoroDownloadProgress * 100)}%</Text>
        )}
        {supported && !kokoroReady && kokoroDownloadProgress === 0 && (
          <ActivityIndicator size="small" color={colors.textMuted} />
        )}
        {supported && kokoroReady && (
          <Icon name="check-circle" size={14} color={colors.primary} />
        )}
      </View>
      <Text style={styles.description}>
        Fast on-device voice synthesis. Used for the speak button in Chat Mode.
      </Text>
      {KOKORO_VOICES.map((voice, i) => {
        const active = selectedVoiceId === voice.id;
        return (
          <TouchableOpacity
            key={voice.id}
            style={[styles.voiceRow, i > 0 && styles.voiceRowBorder]}
            onPress={() => onVoiceChange(voice.id)}
            disabled={!supported}
          >
            <View style={styles.voiceInfo}>
              <Text style={styles.voiceName}>{voice.label}</Text>
              <Text style={styles.voiceMeta}>{voice.accent} · {voice.gender}</Text>
            </View>
            {active && (
              isChangingVoice
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <Icon name="check" size={14} color={colors.primary} />
            )}
          </TouchableOpacity>
        );
      })}
    </Card>
  );
};

// ─── Main screen ──────────────────────────────────────────────────────────────

export const TTSSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [ramGB, setRamGB] = useState<number>(8);

  const {
    isBackboneDownloaded, isVocoderDownloaded,
    isDownloadingBackbone, isDownloadingVocoder,
    backboneDownloadProgress, vocoderDownloadProgress,
    isModelLoaded, isModelLoading,
    audioCacheSizeMB, settings, error,
    kokoroReady, kokoroDownloadProgress, kokoroActiveVoiceId,
    downloadModels, deleteModels, loadModels, unloadModels,
    checkDownloadStatus, refreshCacheSize, clearAudioCache, updateSettings, clearError,
  } = useTTSStore();

  useEffect(() => {
    setRamGB(hardwareService.getTotalMemoryGB());
    checkDownloadStatus();
    refreshCacheSize();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const areBothDownloaded = isBackboneDownloaded && isVocoderDownloaded;
  const isDownloading = isDownloadingBackbone || isDownloadingVocoder;
  const deviceBlocked = ramGB < TTS_BLOCK_RAM_GB;
  const deviceWarning = !deviceBlocked && ramGB < TTS_WARN_RAM_GB;
  const totalSizeMB = TTS_BACKBONE_MODEL.backboneSizeMB + TTS_BACKBONE_MODEL.vocoderSizeMB;

  const handleDelete = () => {
    setAlertState(
      showAlert('Remove TTS Models', 'This will delete both model files and disable text-to-speech.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => { setAlertState(hideAlert()); deleteModels(); } },
      ]),
    );
  };

  const handleClearCache = () => {
    setAlertState(
      showAlert('Clear Audio Cache', `This will delete ${audioCacheSizeMB.toFixed(1)} MB of cached audio.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => { setAlertState(hideAlert()); clearAudioCache(); } },
      ]),
    );
  };

  const handleModeChange = (mode: InterfaceMode) => {
    if (mode === 'audio' && deviceBlocked) { return; }
    updateSettings({ interfaceMode: mode });
    if (mode === 'audio' && !isModelLoaded && areBothDownloaded) { loadModels(); }
    if (mode === 'chat' && isModelLoaded) { unloadModels(); }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Text to Speech</Text>
        {isModelLoading && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>

        <InterfaceModeCard
          mode={settings.interfaceMode}
          deviceBlocked={deviceBlocked}
          areBothDownloaded={areBothDownloaded}
          onModeChange={handleModeChange}
          styles={styles}
        />

        {settings.interfaceMode === 'chat' && (
          <Card style={styles.section}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Text style={styles.toggleTitle}>Enable TTS</Text>
                <Text style={styles.toggleDesc}>Show play buttons on assistant messages</Text>
              </View>
              <Switch value={settings.enabled} onValueChange={(v) => updateSettings({ enabled: v })} trackColor={{ true: colors.primary }} />
            </View>
          </Card>
        )}

        <Card style={styles.section}>
          <Text style={styles.sectionLabel}>Models ({totalSizeMB} MB total)</Text>
          <ProgressRow label="Voice model" sizeMB={TTS_BACKBONE_MODEL.backboneSizeMB}
            downloaded={isBackboneDownloaded} downloading={isDownloadingBackbone}
            progress={backboneDownloadProgress} styles={styles} colors={colors} />
          <ProgressRow label="Audio decoder" sizeMB={TTS_BACKBONE_MODEL.vocoderSizeMB}
            downloaded={isVocoderDownloaded} downloading={isDownloadingVocoder}
            progress={vocoderDownloadProgress} styles={styles} colors={colors} border />
          <View style={styles.downloadActions}>
            {areBothDownloaded
              ? <Button title="Remove Models" variant="outline" size="small" onPress={handleDelete} style={styles.removeButton} />
              : <Button title={isDownloading ? 'Downloading...' : `Download (${totalSizeMB} MB)`}
                  variant="primary" size="small" onPress={downloadModels} disabled={isDownloading || deviceBlocked} />}
          </View>
          {error && <TouchableOpacity onPress={clearError}><Text style={styles.error}>{error}</Text></TouchableOpacity>}
        </Card>

        <KokoroCard
          kokoroReady={kokoroReady}
          kokoroDownloadProgress={kokoroDownloadProgress}
          selectedVoiceId={settings.kokoroVoiceId as KokoroVoiceId}
          isChangingVoice={(settings.kokoroVoiceId as KokoroVoiceId) !== kokoroActiveVoiceId}
          onVoiceChange={(id) => updateSettings({ kokoroVoiceId: id })}
          styles={styles}
          colors={colors}
        />

        {(areBothDownloaded || kokoroReady) && (
          <PlaybackCard settings={settings} onUpdate={updateSettings} colors={colors} styles={styles} />
        )}

        {settings.interfaceMode === 'audio' && (
          <Card style={styles.section}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Text style={styles.toggleTitle}>Audio cache</Text>
                <Text style={styles.toggleDesc}>{audioCacheSizeMB.toFixed(1)} MB</Text>
              </View>
              <Button title="Clear" variant="outline" size="small" onPress={handleClearCache} disabled={audioCacheSizeMB === 0} />
            </View>
          </Card>
        )}

        <CompatibilityCard ramGB={ramGB} deviceBlocked={deviceBlocked} deviceWarning={deviceWarning} styles={styles} colors={colors} />

        <Card style={styles.privacyCard}>
          <Icon name="shield" size={18} color={colors.textSecondary} style={styles.privacyIcon} />
          <Text style={styles.privacyTitle}>Fully private</Text>
          <Text style={styles.privacyText}>
            All speech is generated on your device. Nothing is sent to any server.
          </Text>
        </Card>

      </ScrollView>

      <CustomAlert visible={alertState.visible} title={alertState.title}
        message={alertState.message} buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())} />
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) =>
  ({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row' as const, alignItems: 'center' as const,
      paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
      borderBottomWidth: 1, borderBottomColor: colors.border,
      backgroundColor: colors.surface, ...shadows.small, zIndex: 1, gap: SPACING.md,
    },
    backButton: { padding: SPACING.xs },
    title: { ...TYPOGRAPHY.h2, flex: 1, color: colors.text },
    scrollView: { flex: 1 },
    content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.xxl },
    section: { marginBottom: SPACING.lg },
    sectionLabel: {
      ...TYPOGRAPHY.label, textTransform: 'uppercase' as const, color: colors.textMuted,
      letterSpacing: 0.3, marginBottom: SPACING.sm,
    },
    description: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, lineHeight: 18, marginBottom: SPACING.md },
    modeRow: { flexDirection: 'row' as const, gap: SPACING.sm },
    modeChip: {
      flex: 1, paddingVertical: SPACING.sm, borderRadius: 8, borderWidth: 1,
      borderColor: colors.border, alignItems: 'center' as const, backgroundColor: colors.surfaceLight,
    },
    modeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    modeChipDisabled: { opacity: 0.4 },
    modeChipText: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
    modeChipTextActive: { color: colors.background },
    hintText: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginTop: SPACING.sm },
    toggleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
    toggleRowBorder: { paddingTop: SPACING.md, marginTop: SPACING.md, borderTopWidth: 1, borderTopColor: colors.border },
    toggleInfo: { flex: 1, marginRight: SPACING.md },
    toggleTitle: { ...TYPOGRAPHY.body, color: colors.text },
    toggleDesc: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginTop: 2 },
    modelRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingVertical: SPACING.sm },
    modelRowBorder: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: SPACING.xs },
    modelInfo: { flex: 1 },
    modelName: { ...TYPOGRAPHY.body, color: colors.text },
    modelSize: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginTop: 2 },
    progressText: { ...TYPOGRAPHY.meta, color: colors.primary },
    progressBar: { height: 4, backgroundColor: colors.surfaceLight, borderRadius: 2, overflow: 'hidden' as const, marginBottom: SPACING.xs },
    progressFill: { height: '100%' as const, backgroundColor: colors.primary, borderRadius: 2 },
    downloadActions: { marginTop: SPACING.md },
    removeButton: { borderColor: colors.error },
    error: { ...TYPOGRAPHY.bodySmall, color: colors.error, marginTop: SPACING.md, textAlign: 'center' as const },
    sliderRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: SPACING.xs },
    sliderLabel: { ...TYPOGRAPHY.body, color: colors.text },
    sliderValue: { ...TYPOGRAPHY.body, color: colors.primary },
    sliderMarks: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, marginBottom: SPACING.xs },
    sliderMark: { ...TYPOGRAPHY.meta, color: colors.textMuted },
    compatRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: SPACING.sm },
    compatText: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, flex: 1, lineHeight: 18 },
    errorText: { color: colors.error },
    warningCard: { marginBottom: SPACING.lg, borderColor: colors.border },
    errorCard: { marginBottom: SPACING.lg, borderColor: colors.error },
    privacyCard: { alignItems: 'center' as const, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    privacyIcon: { marginBottom: SPACING.sm },
    privacyTitle: { ...TYPOGRAPHY.h3, color: colors.text, marginBottom: SPACING.sm },
    privacyText: { ...TYPOGRAPHY.body, color: colors.textSecondary, textAlign: 'center' as const, lineHeight: 20 },
    kokoroHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: SPACING.xs },
    voiceRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingVertical: SPACING.sm },
    voiceRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
    voiceInfo: { flex: 1 },
    voiceName: { ...TYPOGRAPHY.body, color: colors.text },
    voiceMeta: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginTop: 2 },
  });
