/* eslint-disable react-native/no-inline-styles, prefer-template, complexity */
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../../theme';
import type { LayoutMode } from '../../theme/appearance';

type Props = { navigation: any; mode: LayoutMode };
type Destination = { label: string; hint: string; icon: string; tab?: string; screen?: string; tint: string; tintDark: string; color: [string, string] };
const destinations: Destination[] = [
  { label: 'Chat', hint: 'Talk with your local AI', icon: 'message-circle', tab: 'ChatsTab', tint: '#DBF0FF', tintDark: '#12283A', color: ['#1D4ED8', '#60A5FA'] },
  { label: 'Projects', hint: 'Your organized work', icon: 'folder', tab: 'ProjectsTab', tint: '#E1F6E8', tintDark: '#12291C', color: ['#047857', '#34D399'] },
  { label: 'Models', hint: 'Choose or manage an AI', icon: 'cpu', tab: 'ModelsTab', tint: '#FFF0D4', tintDark: '#33260F', color: ['#B3620F', '#F2A93B'] },
  { label: 'Daily briefing', hint: "Today's news, in your voice", icon: 'sun', screen: 'DailyBrief', tint: '#EDE5FF', tintDark: '#241A3D', color: ['#6D28D9', '#A78BFA'] },
  { label: 'Recorder', hint: 'Record a talk, get a transcript with speakers', icon: 'mic', screen: 'Recorder', tint: '#FDE7E2', tintDark: '#3A1A15', color: ['#B91C1C', '#F87171'] },
  { label: 'Learn', hint: 'Lessons, games and practice calls in a language', icon: 'book', screen: 'Language', tint: '#E4F2F0', tintDark: '#10302C', color: ['#0F766E', '#2DD4BF'] },
  { label: 'Learn a topic', hint: 'Any subject, on a board the AI designs', icon: 'compass', screen: 'Topics', tint: '#E6EEFB', tintDark: '#14243D', color: ['#1D4ED8', '#60A5FA'] },
  { label: 'Settings', hint: 'Personalize Atlas', icon: 'settings', tab: 'SettingsTab', tint: '#FBE8F0', tintDark: '#381827', color: ['#BE185D', '#F472B6'] },
];
const FOCUS = ['Chat', 'Learn', 'Daily briefing'];

/** Simple, compact, colorful, grid and focus actually change the navigation experience, not just the palette. */
export const QuickHomeScreen: React.FC<Props> = ({ navigation, mode }) => {
  const { colors, isDark } = useTheme();
  const compact = mode === 'compact';
  const grid = mode === 'grid';
  const focus = mode === 'focus';
  const colorful = mode === 'colorful';
  const simple = mode === 'simple' || focus;
  const tiles = compact || grid;
  const items = focus ? destinations.filter((d) => FOCUS.includes(d.label)) : destinations;
  const fontSize = simple ? 21 : compact ? 16 : grid ? 18 : 18;
  const padding = compact ? 10 : simple ? 22 : grid ? 16 : 17;
  const go = (item: Destination) => {
    if (item.tab) navigation.navigate(item.tab);
    else if (item.screen) navigation.getParent()?.navigate(item.screen);
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ScrollView testID={'home-' + mode} contentContainerStyle={{ padding: compact ? 12 : 22, paddingBottom: 44 }}>
        <Text style={{ color: colors.text, fontSize: simple ? 31 : compact ? 24 : 29, fontWeight: '700' }}>Atlas</Text>
        <Text style={{ color: colors.textSecondary, fontSize: simple ? 18 : 14, marginTop: 6, marginBottom: compact ? 10 : 20 }}>
          {focus ? 'What do you want to do?' : simple ? 'What would you like to do?' : compact ? 'Quick access' : 'Choose something to explore'}
        </Text>
        <View style={{ flexDirection: tiles ? 'row' : 'column', flexWrap: 'wrap', gap: tiles ? 8 : 12 }}>
          {items.map(item => {
            const accent = item.color[isDark ? 1 : 0];
            const colored = colorful || grid;
            return (
              <TouchableOpacity key={item.label} testID={'quick-home-' + item.label.toLowerCase()}
                accessibilityRole="button" accessibilityLabel={item.label + '. ' + item.hint}
                onPress={() => go(item)} style={{
                  flexDirection: tiles ? 'column' : 'row', alignItems: 'center',
                  flexBasis: tiles ? '47%' : undefined, flexGrow: tiles ? 1 : 0,
                  backgroundColor: colored ? (isDark ? item.tintDark : item.tint) : colors.surface,
                  borderColor: colored ? accent : colors.border,
                  borderWidth: 1, borderRadius: compact ? 10 : simple ? 19 : 15,
                  padding, minHeight: focus ? 120 : grid ? 140 : simple ? 92 : compact ? 90 : 76, gap: tiles ? 8 : 15,
                  justifyContent: grid ? 'center' : undefined,
                }}>
                <View style={{
                  width: simple ? 46 : grid ? 54 : 36, height: simple ? 46 : grid ? 54 : 36, borderRadius: 12,
                  backgroundColor: colored ? (isDark ? colors.surfaceLight : '#FFFFFF') : colors.surfaceLight,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon name={item.icon} size={simple ? 26 : grid ? 30 : 21} color={colored ? accent : colors.primary} />
                </View>
                <View style={{ flex: tiles ? undefined : 1, alignItems: tiles ? 'center' : 'flex-start' }}>
                  <Text style={{ fontSize, color: colors.text, fontWeight: '700' }}>{item.label}</Text>
                  {!tiles && <Text style={{ color: colors.textSecondary, fontSize: simple ? 15 : 12, marginTop: 4 }}>{item.hint}</Text>}
                </View>
                {!tiles && <Icon name="chevron-right" size={simple ? 23 : 19} color={colors.textMuted} />}
              </TouchableOpacity>
            );
          })}
        </View>
        {(colorful || focus) && <Text style={{ color: colors.textMuted, marginTop: 20, textAlign: 'center' }}>
          Your models and conversations stay on your device.
        </Text>}
      </ScrollView>
    </SafeAreaView>
  );
};
