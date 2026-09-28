import { Accordion } from '../Accordion';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import React, { useEffect, useState } from 'react';
import { Text, TextInput, View, Switch } from 'react-native';
import { VIDEO_DEFAULTS } from '@offgrid/models';
import { useAppStore } from '../../stores';
import { useTheme, useThemedStyles } from '../../theme';
import { SliderSetting } from '../SliderSetting';
import { createStyles } from './styles';

const CONTROLS = [
  { key: 'width', label: 'Width', min: 256, max: 832, step: 16 },
  { key: 'height', label: 'Height', min: 192, max: 480, step: 16 },
  { key: 'frames', label: 'Frames', min: 9, max: 81, step: 4 },
  { key: 'fps', label: 'Frames per second', min: 4, max: 24, step: 1 },
  { key: 'steps', label: 'Steps', min: 4, max: 50, step: 1 },
  { key: 'guidance', label: 'Guidance', min: 0, max: 20, step: 0.5 },
] as const;
export const VideoGenerationSection: React.FC = () => {
  const {
    settings,
    updateSettings,
    activeVideoModelId,
    downloadedVideoModels,
  } = useAppStore();
  const { colors } = useTheme(),
    styles = useThemedStyles(createStyles);
  const model = downloadedVideoModels.find(m => m.id === activeVideoModelId);
  const remoteName = useRemoteServerStore(
    s =>
      s.servers.find(server => server.id === s.activeRemoteMediaServerIds.video)
        ?.mediaModels?.video,
  );
  const key =
    remoteName ??
    model?.files.find(f => f.role === 'primary')?.name ??
    'default';
  const saved =
    settings.videoParams?.[key] ?? settings.videoParams?.default ?? {};
  const values = { ...VIDEO_DEFAULTS, ...saved };
  const [seedText, setSeedText] = useState(
    settings.videoSeed === -1 ? '' : String(settings.videoSeed ?? ''),
  );
  useEffect(
    () =>
      setSeedText(
        settings.videoSeed === -1 ? '' : String(settings.videoSeed ?? ''),
      ),
    [settings.videoSeed],
  );
  const saveSeed = () => {
    const seed = seedText.trim() === '' ? -1 : Number(seedText);
    if (Number.isInteger(seed) && seed >= -1 && seed <= 2147483647)
      updateSettings({ videoSeed: seed });
    else
      setSeedText(
        settings.videoSeed === -1 ? '' : String(settings.videoSeed ?? ''),
      );
  };
  return (
    <Accordion title="Video generation" variant="plain">
      <Text style={styles.settingDescription}>
        {remoteName ?? model?.name ?? 'Default video settings'}
      </Text>
      {CONTROLS.map(control => (
        <SliderSetting
          key={control.key}
          compact
          label={control.label}
          value={values[control.key]}
          min={control.min}
          max={control.max}
          step={control.step}
          onChange={value =>
            updateSettings({
              videoParams: {
                ...settings.videoParams,
                [key]: {
                  ...saved,
                  [control.key]:
                    control.key === 'frames'
                      ? 1 + Math.round((value - 1) / 4) * 4
                      : control.key === 'width' || control.key === 'height'
                        ? Math.round(value / 16) * 16
                        : value,
                },
              },
            })
          }
        />
      ))}
      <Text style={styles.settingLabel}>Seed</Text>
      <TextInput
        accessibilityLabel="Video seed"
        value={seedText}
        keyboardType="number-pad"
        style={{ color: colors.text }}
        placeholderTextColor={colors.textMuted}
        placeholder="Random"
        onChangeText={setSeedText}
        onEndEditing={saveSeed}
      />
      <Text style={styles.settingDescription}>
        Leave blank for a new seed with each video.
      </Text>
      <Text style={styles.settingLabel}>Negative prompt</Text>
      <TextInput
        accessibilityLabel="Video negative prompt"
        multiline
        value={settings.videoNegative ?? ''}
        style={{ color: colors.text }}
        placeholderTextColor={colors.textMuted}
        placeholder="What to avoid"
        onChangeText={videoNegative => updateSettings({ videoNegative })}
      />
      <View style={styles.settingHeader}>
        <Text style={styles.settingLabel}>Enhance video prompts</Text>
        <Switch
          value={settings.enhanceVideoPrompts ?? false}
          onValueChange={enhanceVideoPrompts =>
            updateSettings({ enhanceVideoPrompts })
          }
        />
      </View>
    </Accordion>
  );
};
