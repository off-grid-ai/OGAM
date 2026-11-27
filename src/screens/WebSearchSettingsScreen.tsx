import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  WEB_SEARCH_COPY,
  WEB_SEARCH_PROVIDERS,
  normalizeSearxngUrl,
  testWebSearchProvider,
  webSearchNeeds,
  type WebSearchProviderId,
  type WebSearchSettings,
  type WebSearchTestResult,
} from '@offgrid/models';
import { AliveScreen } from '../components/AliveScreen';
import { ScreenHeader } from '../components/ScreenHeader';
import { TouchableOpacity } from '../components/Touchable';
import { Button } from '../components/Button';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';
import { cardSurface } from '../theme/surface';
import { useAppStore } from '../stores';
import { getWebSearchKey, removeWebSearchKey, saveWebSearchKey } from '../services/webSearchKey';

type Check = { state: 'idle' } | { state: 'testing' } | { state: 'done'; result: WebSearchTestResult };

/** An icon button on the saved-key row: the glyph is enough, the label is for screen readers. */
const KeyAction: React.FC<{ icon: string; label: string; onPress: () => void; testID: string }> = ({ icon, label, onPress, testID }) => {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={label} hitSlop={12} style={{ padding: SPACING.sm }}>
      <Icon name={icon} size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );
};

/**
 * Tools → Web search. Where a model's searches go: the free built-in search, the person's own SearXNG
 * server, or their own Brave Search or Tavily key. A pick applies at once; Test saves what was typed
 * and asks only that provider. Whatever is chosen, the built-in search steps in when it does not answer.
 */
export const WebSearchSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const settings = useAppStore(s => s.settings.webSearch) ?? DEFAULT_WEB_SEARCH_SETTINGS;
  const updateSettings = useAppStore(s => s.updateSettings);
  const provider = settings.provider;
  const needs = webSearchNeeds(provider);

  const [address, setAddress] = useState(settings.searxngUrl ?? '');
  const [keyDraft, setKeyDraft] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [check, setCheck] = useState<Check>({ state: 'idle' });

  useEffect(() => {
    let live = true;
    setHasKey(false);
    if (needs === 'key') {
      getWebSearchKey(provider)
        .then(key => live && setHasKey(Boolean(key)))
        .catch(() => live && setHasKey(false));
    }
    return () => { live = false; };
  }, [provider, needs]);

  const save = (patch: Partial<WebSearchSettings>) => updateSettings({ webSearch: { ...settings, ...patch } });

  const choose = (id: WebSearchProviderId) => {
    save({ provider: id });
    setCheck({ state: 'idle' });
    setKeyDraft('');
    setReplacing(false);
  };

  const saveAddress = (): string => {
    const url = normalizeSearxngUrl(address);
    setAddress(url);
    if (url !== (settings.searxngUrl ?? '')) save({ searxngUrl: url });
    return url;
  };

  const runTest = async () => {
    setCheck({ state: 'testing' });
    try {
      let apiKey: string | null = null;
      const searxngUrl = needs === 'address' ? saveAddress() : settings.searxngUrl;
      if (needs === 'key') {
        const typed = keyDraft.trim();
        if (typed) {
          await saveWebSearchKey(provider, typed);
          setHasKey(true);
          setReplacing(false);
          setKeyDraft('');
        }
        apiKey = typed || (await getWebSearchKey(provider));
      }
      const result = await testWebSearchProvider({ fetch, settings: { provider, searxngUrl }, apiKey });
      setCheck({ state: 'done', result });
    } catch (error) {
      setCheck({ state: 'done', result: { ok: false, reason: error instanceof Error ? error.message : String(error) } });
    }
  };

  const removeKey = async () => {
    await removeWebSearchKey(provider).catch(() => undefined);
    setHasKey(false);
    setCheck({ state: 'idle' });
  };

  const showKeyField = needs === 'key' && (!hasKey || replacing);

  return (
    <AliveScreen style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title={WEB_SEARCH_COPY.title} onBack={() => navigation.goBack()} backTestID="web-search-back" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{WEB_SEARCH_COPY.intro}</Text>
        <View style={styles.group} accessibilityRole="radiogroup">
          {WEB_SEARCH_PROVIDERS.map((p, index) => {
            const selected = p.id === provider;
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.row, index > 0 && styles.rowDivided]}
                onPress={() => choose(p.id)}
                testID={`web-search-provider-${p.id}`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{p.label}</Text>
                  <Text style={styles.rowSubtitle}>{p.detail}</Text>
                </View>
                {selected ? <Icon name="check" size={18} color={colors.primary} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>

        {needs === 'address' && (
          <>
            <Text style={styles.label}>{WEB_SEARCH_COPY.addressLabel}</Text>
            <TextInput
              style={styles.input}
              value={address}
              onChangeText={setAddress}
              onEndEditing={saveAddress}
              placeholder={WEB_SEARCH_COPY.addressPlaceholder}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              testID="web-search-address"
              accessibilityLabel={WEB_SEARCH_COPY.addressLabel}
            />
          </>
        )}

        {needs === 'key' && (
          <>
            <Text style={styles.label}>{WEB_SEARCH_COPY.keyLabel}</Text>
            {showKeyField ? (
              <TextInput
                style={styles.input}
                value={keyDraft}
                onChangeText={setKeyDraft}
                placeholder={WEB_SEARCH_COPY.keyPlaceholder}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                testID="web-search-key"
                accessibilityLabel={WEB_SEARCH_COPY.keyLabel}
              />
            ) : (
              <View style={[styles.group, styles.row]} testID="web-search-key-saved">
                <Icon name="lock" size={16} color={colors.textSecondary} />
                <Text style={[styles.rowTitle, styles.rowText]}>{WEB_SEARCH_COPY.keySaved}</Text>
                <KeyAction icon="edit-2" label={WEB_SEARCH_COPY.replaceKey} onPress={() => setReplacing(true)} testID="web-search-replace-key" />
                <KeyAction icon="trash-2" label={WEB_SEARCH_COPY.removeKey} onPress={removeKey} testID="web-search-remove-key" />
              </View>
            )}
          </>
        )}

        <View style={styles.testRow}>
          <Button
            title={check.state === 'testing' ? WEB_SEARCH_COPY.testing : WEB_SEARCH_COPY.test}
            variant="secondary"
            size="small"
            loading={check.state === 'testing'}
            onPress={runTest}
            testID="web-search-test"
            accessibilityLabel={WEB_SEARCH_COPY.test}
          />
          {check.state === 'done' && <TestResult result={check.result} />}
        </View>
        {provider !== 'builtin' && <Text style={styles.hint}>{WEB_SEARCH_COPY.fallback}</Text>}
      </ScrollView>
    </AliveScreen>
  );
};

const TestResult: React.FC<{ result: WebSearchTestResult }> = ({ result }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.result} testID="web-search-result" accessibilityLiveRegion="polite">
      <Icon name={result.ok ? 'check-circle' : 'alert-circle'} size={16} color={result.ok ? colors.primary : colors.error} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{result.ok ? WEB_SEARCH_COPY.works : WEB_SEARCH_COPY.failed}</Text>
        {!result.ok && <Text style={styles.rowSubtitle}>{result.reason}</Text>}
      </View>
    </View>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: SPACING.xl, paddingBottom: SPACING.xxl },
  intro: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, marginBottom: SPACING.md },
  group: { ...cardSurface(colors), overflow: 'hidden' as const },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    minHeight: 44,
  },
  rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderLight },
  rowText: { flex: 1 },
  rowTitle: { ...TYPOGRAPHY.body, color: colors.text },
  rowSubtitle: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
  label: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
    marginTop: SPACING.xl,
    marginBottom: SPACING.sm,
  },
  input: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  testRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md, marginTop: SPACING.lg },
  result: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm },
  hint: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, marginTop: SPACING.md },
});
