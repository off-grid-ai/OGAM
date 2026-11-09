/** Settings > Appearance & AI style: theme, background, accent, font, text size, bottom bar, and how the AI answers. */
import React from 'react';
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Button } from '../components/Button';
import { pick as pickDocument, keepLocalCopy, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useAppStore } from '../stores';
import { parseCustomTheme, ACCENTS, SKINS, CHAT_LAYOUTS, FONT_CHOICES, PALETTES, TEXT_SIZES, LAYOUT_MODES, type Appearance } from '../theme/appearance';
import { NavBarSettings } from '../components/NavBarSettings';
import { AI_LENGTHS, AI_LEVELS, AI_TONES, type AiStyle } from '../services/aiStyle';
import { ABOUT_FIELDS, useAboutMe } from '../stores/aboutMeStore';

type Option<T> = { id: T; name: string; hint?: string };

function Chips<T extends string | boolean | undefined>({ options, value, onPick, testID }: {
  options: Array<Option<T>>; value: T; onPick: (v: T) => void; testID?: string;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.chips}>
      {options.map(o => {
        const on = o.id === value;
        return (
          <TouchableOpacity key={String(o.id)} testID={testID ? `${testID}-${String(o.id)}` : undefined}
            accessibilityRole="button" accessibilityState={{ selected: on }}
            onPress={() => onPick(o.id)} style={[styles.chip, on && styles.chipOn]}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.name}</Text>
            {!!o.hint && <Text style={styles.chipHint}>{o.hint}</Text>}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

export const AppearanceScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors, isDark } = useTheme();
  const styles = useThemedStyles(createStyles);
  const themeMode = useAppStore(s => s.themeMode);
  const setThemeMode = useAppStore(s => s.setThemeMode);
  const settings = useAppStore(s => s.settings);
  const updateSettings = useAppStore(s => s.updateSettings);
  const appearance: Appearance = settings.appearance ?? {};
  const ai: AiStyle = settings.aiStyle ?? {};
  const about = useAboutMe(st => st.about);
  const memories = useAboutMe(st => st.memories);
  const setAbout = useAboutMe(st => st.setField);
  const removeMemory = useAboutMe(st => st.removeMemory);
  const setLook = (patch: Partial<Appearance>) => updateSettings({ appearance: { ...appearance, ...patch } });
  const [themeText, setThemeText] = React.useState('');
  const [themeMsg, setThemeMsg] = React.useState('');
  const importTheme = () => {
    const r = parseCustomTheme(themeText);
    if (r.error) { setThemeMsg(r.error); return; }
    setLook({ custom: r.theme, cornerRadius: undefined }); setThemeMsg(`Applied "${r.theme!.name}".`); setThemeText('');
  };
  const pickBackground = async () => {
    try {
      const [file] = await pickDocument({ type: [types.images], mode: 'import', allowMultiSelection: false });
      if (!file) return;
      const local = await keepLocalCopy({ files: [{ uri: file.uri, fileName: file.name ?? 'background.jpg' }], destination: 'documentDirectory' });
      const done = local[0];
      if (done?.status !== 'success') throw new Error('Could not keep a copy of that picture.');
      setLook({ backgroundImage: { uri: done.localUri, dim: appearance.backgroundImage?.dim ?? 0.45 } });
    } catch (e: any) { if (!isErrorWithCode(e) || e.code !== errorCodes.OPERATION_CANCELED) Alert.alert('Could not use that picture', String(e?.message || e)); }
  };
  const setAi = (patch: Partial<AiStyle>) => updateSettings({ aiStyle: { ...ai, ...patch } });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} accessibilityLabel="Back">
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Appearance & AI style</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section}>Look</Text>
        <Text style={styles.label}>Easy mode</Text>
        <Button title={appearance.layoutMode === 'focus' ? 'Easy mode is on. Turn off' : 'Turn on easy mode'} testID="easy-mode" variant={appearance.layoutMode === 'focus' ? 'outline' : 'primary'}
          onPress={() => setLook(appearance.layoutMode === 'focus' ? { layoutMode: 'standard' } : { layoutMode: 'focus', chatLayout: 'clean', density: 'spacious' })} />
        <Text style={styles.note}>Easy mode shows only chat, learning and the briefing, with plain replies and larger spacing. One tap turns it off.</Text>

        <Text style={styles.label}>Style</Text>
        <Chips testID="skin" value={appearance.skin ?? 'none'}
          onPick={id => (id === 'none'
            ? setLook({ skin: undefined })
            : setLook({ ...SKINS.find(k => k.id === id)!.look, skin: id as typeof SKINS[number]['id'] }))}
          options={[{ id: 'none', name: 'Atlas', hint: 'The standard look' }, ...SKINS.map(k => ({ id: k.id, name: k.name, hint: k.hint }))]} />
        <Text style={styles.note}>A style sets the colors, font, chat style and the shape of boxes in one go. You can still change any part below.</Text>

        <Text style={styles.label}>Corner roundness</Text>
        <Chips testID="corner-radius" value={String(appearance.cornerRadius ?? appearance.custom?.cornerRadius ?? 'skin')}
          onPick={id => setLook({ cornerRadius: id === 'skin' ? undefined : Number(id) })}
          options={[{ id: 'skin', name: 'As styled' }, { id: '0', name: 'Square' }, { id: '0.5', name: 'Slight' }, { id: '1', name: 'Standard' }, { id: '1.5', name: 'Round' }, { id: '2', name: 'Very round' }]} />

        <Text style={styles.label}>Background picture</Text>
        <Button title={appearance.backgroundImage ? 'Choose a different picture' : 'Choose a picture'} variant="outline" testID="bg-pick" onPress={pickBackground} />
        {!!appearance.backgroundImage && <>
          <Chips testID="bg-dim" value={String(appearance.backgroundImage.dim)} onPick={id => setLook({ backgroundImage: { ...appearance.backgroundImage!, dim: Number(id) } })}
            options={[{ id: '0.2', name: 'Light dim' }, { id: '0.45', name: 'Medium' }, { id: '0.7', name: 'Dark' }, { id: '0.85', name: 'Very dark' }]} />
          <Button title="Remove the picture" variant="ghost" testID="bg-remove" onPress={() => setLook({ backgroundImage: undefined })} />
        </>}
        <Text style={styles.note}>The picture sits behind every screen and is dimmed so text stays readable. Boxes and cards keep their colour. Some pop-ups may look different over a picture.</Text>

        <Text style={styles.label}>Import a theme</Text>
        <Text style={styles.note}>Paste a theme file: {'{"name":"Mine","light":{"background":"#fff8f0","primary":"#c2410c"},"dark":{"background":"#1a1008"},"cornerRadius":1.5}'}. Colour names: background, surface, surfaceLight, surfaceHover, border, borderLight, divider, text, textSecondary, textMuted, primary, primaryDark, error, borderFocus.</Text>
        <TextInput testID="theme-json" value={themeText} onChangeText={setThemeText} multiline autoCapitalize="none" autoCorrect={false} placeholder="Paste theme JSON" placeholderTextColor={colors.textMuted} style={[styles.note, { color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 90 }]} />
        <Button title="Apply theme" onPress={importTheme} testID="theme-apply" />
        {!!themeMsg && <Text testID="theme-msg" style={styles.note}>{themeMsg}</Text>}
        {!!appearance.custom && <Button title={`Remove "${appearance.custom.name}"`} variant="outline" onPress={() => { setLook({ custom: undefined }); setThemeMsg('Removed.'); }} testID="theme-remove" />}

        <Text style={styles.label}>Light or dark</Text>
        <Chips testID="theme-mode" value={themeMode} onPick={setThemeMode}
          options={[{ id: 'system', name: 'Match phone' }, { id: 'light', name: 'Light' }, { id: 'dark', name: 'Dark' }]} />

        <Text style={styles.label}>Layout style</Text>
        <Chips testID="layout-mode" value={appearance.layoutMode ?? 'standard'}
          onPick={layoutMode => setLook({ layoutMode })} options={LAYOUT_MODES} />
        <Text style={styles.label}>Spacing</Text>
        <Chips testID="density" value={appearance.density ?? (appearance.layoutMode === 'compact' ? 'compact' : appearance.layoutMode === 'simple' ? 'spacious' : 'comfortable')}
          onPick={density => setLook({ density })}
          options={[{ id: 'comfortable', name: 'Comfortable' }, { id: 'compact', name: 'Tight' }, { id: 'spacious', name: 'Spacious' }]} />
        <Text style={styles.label}>Background</Text>
        <View style={styles.chips}>
          {PALETTES.map(p => {
            const on = (appearance.palette ?? 'classic') === p.id;
            const swatch = (isDark ? p.dark : p.light)?.surface ?? colors.surface;
            return (
              <TouchableOpacity key={p.id} testID={`palette-${p.id}`} accessibilityRole="button" accessibilityState={{ selected: on }}
                onPress={() => setLook({ palette: p.id })} style={[styles.chip, on && styles.chipOn]}>
                <View style={[styles.dot, { backgroundColor: swatch }]} />
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{p.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>Accent color</Text>
        <View style={styles.chips}>
          {ACCENTS.map(a => {
            const on = (appearance.accent ?? 'amber') === a.id;
            return (
              <TouchableOpacity key={a.id} testID={`accent-${a.id}`} accessibilityRole="button" accessibilityLabel={a.name}
                accessibilityState={{ selected: on }} onPress={() => setLook({ accent: a.id })}
                style={[styles.swatch, { backgroundColor: (isDark ? a.dark : a.light).primary }, on && styles.swatchOn]}>
                {(on || a.id === 'multi') && <Icon name={on ? 'check' : 'grid'} size={16} color={colors.background} />}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>Font</Text>
        <Chips testID="font" value={appearance.font ?? 'atlas'} onPick={font => setLook({ font })}
          options={FONT_CHOICES.map(f => ({ id: f.id, name: f.name }))} />

        <Text style={styles.label}>Text size</Text>
        <Chips testID="text-size" value={appearance.textSize ?? 'normal'} onPick={textSize => setLook({ textSize })}
          options={TEXT_SIZES.map(t => ({ id: t.id, name: t.name }))} />

        <Text style={styles.label}>Chat layout</Text>
        <Chips testID="chat-layout" value={appearance.chatLayout ?? 'clean'} onPick={chatLayout => setLook({ chatLayout })}
          options={CHAT_LAYOUTS.map(l => ({ id: l.id, name: l.name, hint: l.hint }))} />

        <View style={styles.preview}>
          <Text style={[styles.previewTitle, { fontFamily: FONT_CHOICES.find(f => f.id === appearance.font)?.heading ?? 'serif' }]}>Preview</Text>
          <Text style={[styles.previewBody, { fontFamily: FONT_CHOICES.find(f => f.id === appearance.font)?.body ?? 'sans-serif' }]}>This is how chats and notes will look.</Text>
          <Text style={styles.previewMeta}>Font and size apply to every screen right away.</Text>
        </View>

        <View style={styles.chips}>
          <TouchableOpacity testID="look-surprise" accessibilityRole="button" style={styles.chip}
            onPress={() => setLook({ palette: pick(PALETTES).id, accent: pick(ACCENTS).id })}>
            <Icon name="shuffle" size={14} color={colors.text} />
            <Text style={styles.chipText}>Surprise me</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="look-reset" accessibilityRole="button" style={styles.chip}
            onPress={() => updateSettings({ appearance: { chatLayout: appearance.chatLayout } })}>
            <Icon name="rotate-ccw" size={14} color={colors.text} />
            <Text style={styles.chipText}>Reset the look</Text>
          </TouchableOpacity>
        </View>

        <NavBarSettings />

        <Text style={styles.section}>Feel</Text>
        <Text style={styles.label}>Vibration on taps</Text>
        <Chips testID="haptics" value={!settings.hapticsOff} onPick={on => updateSettings({ hapticsOff: !on })}
          options={[{ id: true, name: 'On' }, { id: false, name: 'Off' }]} />

        <Text style={styles.section}>AI style</Text>
        <Text style={styles.note}>Applies to every chat, agent and project. A project or agent can still add its own instructions.</Text>
        <Text style={styles.label}>How much it says</Text>
        <Chips testID="ai-length" value={ai.length ?? 'balanced'} onPick={length => setAi({ length })} options={AI_LENGTHS} />
        <Text style={styles.label}>Tone</Text>
        <Chips testID="ai-tone" value={ai.tone ?? 'neutral'} onPick={tone => setAi({ tone })} options={AI_TONES} />
        <Text style={styles.label}>Explanations</Text>
        <Chips testID="ai-level" value={ai.level ?? 'normal'} onPick={level => setAi({ level })} options={AI_LEVELS} />
        <Text style={styles.label}>Emoji</Text>
        <Chips testID="ai-emoji" value={ai.emoji} onPick={emoji => setAi({ emoji })}
          options={[{ id: undefined, name: 'Model decides' }, { id: false, name: 'Never' }, { id: true, name: 'Sometimes' }]} />
        <Text style={styles.label}>Follow-up questions</Text>
        <Chips testID="ai-followups" value={ai.followUps} onPick={followUps => setAi({ followUps })}
          options={[{ id: undefined, name: 'Only when needed' }, { id: false, name: 'Never' }, { id: true, name: 'When useful' }]} />
        <Text style={styles.label}>Where I am</Text>
        <Chips testID="share-location" value={settings.shareLocation !== false} onPick={on => updateSettings({ shareLocation: on })}
          options={[{ id: true, name: 'Tell the AI the city' }, { id: false, name: 'Never' }]} />
        <Text style={styles.note}>The AI can say what city you are in or near, from the phone's last GPS reading and a built-in list of large cities. It never leaves the phone, and the AI only gets the city and country, not coordinates. Needs location allowed once (open Maps).</Text>
        <Text style={styles.section}>About you</Text>
        <Text style={styles.note}>Every chat knows this, so you do not have to repeat it. Fill in only what you want; each box is optional.</Text>
        {ABOUT_FIELDS.map(f => (
          <View key={f.key}>
            <Text style={styles.label}>{f.label}</Text>
            <TextInput testID={`about-${f.key}`} value={about[f.key]} onChangeText={v => setAbout(f.key, v)}
              placeholder={f.placeholder} placeholderTextColor={colors.textMuted} multiline={f.multiline} style={styles.input} />
          </View>
        ))}
        {memories.length > 0 && (
          <View>
            <Text style={styles.label}>Things the assistant remembered</Text>
            {memories.map((m, i) => (
              <TouchableOpacity key={`${i}-${m}`} onPress={() => removeMemory(i)} accessibilityLabel={`Forget: ${m}`}>
                <Text style={styles.note}>{m}  (tap to forget)</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <Text style={styles.label}>Always remember (standing instructions)</Text>
        <TextInput testID="ai-custom" value={ai.custom ?? ''} onChangeText={custom => setAi({ custom: custom.slice(0, 1200) })}
          placeholder="e.g. Use metric units. I am studying nursing. Call me Sam."
          placeholderTextColor={colors.textMuted} multiline style={styles.input} />
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md },
  back: { padding: SPACING.xs, marginRight: SPACING.sm },
  title: { ...TYPOGRAPHY.h2, color: colors.text },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl * 2 },
  section: { ...TYPOGRAPHY.h2, color: colors.text, marginTop: SPACING.lg, marginBottom: SPACING.xs },
  label: { ...TYPOGRAPHY.label, color: colors.textSecondary, marginTop: SPACING.md, marginBottom: SPACING.sm, textTransform: 'uppercase' as const },
  note: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACING.sm },
  chip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.xs, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.surface },
  chipText: { ...TYPOGRAPHY.bodySmall, color: colors.text },
  chipTextOn: { color: colors.primary },
  chipHint: { ...TYPOGRAPHY.metaSmall, color: colors.textMuted },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: colors.borderLight },
  swatch: { width: 36, height: 36, borderRadius: 18, alignItems: 'center' as const, justifyContent: 'center' as const },
  swatchOn: { borderWidth: 3, borderColor: colors.text },
  preview: { marginTop: SPACING.lg, padding: SPACING.md, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: SPACING.xs },
  previewTitle: { ...TYPOGRAPHY.h2, color: colors.primary },
  previewBody: { ...TYPOGRAPHY.body, color: colors.text },
  previewMeta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  input: { ...TYPOGRAPHY.body, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: SPACING.md, minHeight: 90, textAlignVertical: 'top' as const },
});
