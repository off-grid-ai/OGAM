import React, { useEffect, useMemo, useState } from 'react';
import { getMaxContextForDevice } from '../../services/llmHelpers';
import { autoReplyTokens } from '../../services/contextWindow';
import { hardwareService } from '../../services/hardware';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../../theme';
import { useChatStore, useAppStore } from '../../stores';
import { selectIsLiteRT } from '../../stores/appStore';
import { contextCompactionService, llmService } from '../../services';
import { useChatPrefs } from '../../atlasTools/chatPrefs';
import { useAgentStore } from '../../stores/agentStore';

/** Chat settings: this chat's own instructions, and compressing older messages so long chats keep going. */
export const ChatContextSection: React.FC = () => {
  const { colors } = useTheme();
  const styles = useMemo(() => makeChipStyles(colors), [colors]);
  const convId = useChatStore((s) => s.activeConversationId);
  const conv = useChatStore((s) => s.conversations.find((c) => c.id === s.activeConversationId));
  const [text, setText] = useState(conv?.instructions || '');
  const [busy, setBusy] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const autoCompress = useChatPrefs((s) => s.autoCompress);
  const setPrefs = useChatPrefs((s) => s.set);
  const agentName = useAgentStore((s) => s.agents.find((a) => a.id === s.activeAgentId)?.name);
  const agentCtx = useAgentStore((s) => s.agents.find((a) => a.id === s.activeAgentId)?.contextLength);
  const isLiteRT = useAppStore(selectIsLiteRT);
  const ctxKey = isLiteRT ? 'liteRTMaxTokens' : 'contextLength';
  const ctxValue = useAppStore((s) => (s.settings as any)[ctxKey] as number) || 4096;
  const contextMode = useAppStore((s) => s.settings.contextMode ?? 'manual');
  const modelMax = useAppStore((s) => s.modelMaxContext);
  const readLong = useAppStore((s) => s.settings.readLongInParts !== false);
  const replyMode = useAppStore((s) => s.settings.maxTokensMode ?? 'auto');
  const replyTokens = useAppStore((s) => s.settings.maxTokens);
  // Same ceiling the loader uses for this phone's RAM (bigger choices would be cut down anyway).
  const ramGB = hardwareService.getTotalMemoryGB();
  const deviceCap = ramGB === 4 ? 8192 : getMaxContextForDevice(ramGB * 1024 ** 3); // 4 = "not measured yet"
  const updateSettings = useAppStore((s) => s.updateSettings);
  useEffect(() => { setText(conv?.instructions || ''); }, [convId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Write to the chat a moment after typing stops (not on every key press).
  useEffect(() => {
    if (!convId || text === (conv?.instructions || '')) return;
    const t = setTimeout(() => {
      useChatStore.setState((s: any) => ({ conversations: s.conversations.map((c: any) => (c.id === convId ? { ...c, instructions: text } : c)) }));
    }, 600);
    return () => clearTimeout(t);
  }, [text, convId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!convId || !conv) return null;

  const save = (v: string) => setText(v);
  const compress = async () => {
    if (!llmService.isModelLoaded()) { Alert.alert('Load a model first', 'Compressing uses the loaded model to write the summary.'); return; }
    if (llmService.isCurrentlyGenerating()) { Alert.alert('Busy', 'Wait for the answer to finish, then try again.'); return; }
    setBusy(true);
    try {
      const did = await contextCompactionService.compactNow(convId, 4);
      Alert.alert(did ? 'Chat compressed' : 'Nothing to compress', did ? 'Older messages were summarized. They stay on screen, but the AI now reads the short summary instead, so the chat can go on much longer.' : 'This chat is still short.');
    } catch (e: any) { Alert.alert('Could not compress', String(e?.message || e)); } finally { setBusy(false); }
  };
  const box = { backgroundColor: colors.surface, borderRadius: 10, padding: 12, marginBottom: 12 };
  return (
    <View>
      <View style={box}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>Memory size (context)</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
          How much of the conversation and documents the model can keep in mind. Bigger remembers more but uses more RAM and starts slower. The model reloads after a change. If a size is too much for this phone or model, Atlas goes back to the last size that worked.{agentCtx ? ` The ${agentName} agent sets its own size (${agentCtx / 1024}K): change it in Agents.` : ''}
        </Text>
        {!isLiteRT && (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Automatically select a safe context window"
            onPress={() => updateSettings({ contextMode: 'auto' })}
            style={{ alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16,
              backgroundColor: contextMode === 'auto' ? colors.primary : colors.background }}>
            <Text style={{ color: contextMode === 'auto' ? colors.background : colors.text }}>Auto (RAM-aware)</Text>
          </TouchableOpacity>
        )}
        <View style={styles.chipRow}>
          {(isLiteRT ? [2048, 4096, 8192] : [2048, 4096, 8192, 16384].filter((n) => n <= deviceCap && (!modelMax || n <= Math.max(modelMax, 4096)))).map((n) => (
            <TouchableOpacity key={n} accessibilityRole="button" accessibilityLabel={`Use ${n / 1024}K manual context`}
              onPress={() => updateSettings({ [ctxKey]: n, ...(!isLiteRT && { contextMode: 'manual' }) } as any)}
              style={(isLiteRT || contextMode === 'manual') && ctxValue === n ? styles.chipOn : styles.chip}>
              <Text style={(isLiteRT || contextMode === 'manual') && ctxValue === n ? styles.chipTextOn : styles.chipText}>{n / 1024}K</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.subTitle}>Reply length</Text>
        <Text style={styles.hint}>
          How much the model may write in one answer. Auto follows the memory size above, so long files, code and reports are written in one go instead of stopping and needing "continue".
        </Text>
        <View style={styles.chipRow}>
          {([['auto', 'Auto'], [512, '512'], [1024, '1K'], [2048, '2K'], [4096, '4K'], [8192, '8K']] as const).map(([v, label]) => {
            const on = v === 'auto' ? replyMode !== 'manual' : replyMode === 'manual' && replyTokens === v;
            return (
              <TouchableOpacity key={String(v)} accessibilityRole="button" accessibilityLabel={v === 'auto' ? 'Automatic reply length' : `Reply length ${label} tokens`}
                onPress={() => updateSettings(v === 'auto' ? { maxTokensMode: 'auto' } : { maxTokens: v, maxTokensMode: 'manual' })}
                style={on ? styles.chipOn : styles.chip}>
                <Text style={on ? styles.chipTextOn : styles.chipText}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {replyMode !== 'manual' && <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 6 }}>Right now: up to {autoReplyTokens(ctxValue).toLocaleString()} tokens per answer.</Text>}
        <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 6 }}>More options (temperature, length, GPU) are under Text generation below.</Text>
      </View>
      <View style={box}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>Instructions for this chat</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
          Added under {agentName ? `the ${agentName} agent's` : 'the agent\'s'} and the project's instructions, only in this chat. Edit agents in the Agents tab and projects in Projects.
        </Text>
        <TextInput value={text} onChangeText={save} multiline placeholder="e.g. Answer in Spanish. I am a nurse, use medical terms." placeholderTextColor={colors.textMuted}
          style={{ color: colors.text, backgroundColor: colors.background, borderRadius: 8, padding: 10, marginTop: 8, minHeight: 60, textAlignVertical: 'top' }} />
      </View>
      <View style={box}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>Read very long messages in parts</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>A message longer than the model's memory is read piece by piece and answered from notes, instead of its start being cut off. Slower.</Text>
          </View>
          <Switch value={readLong} onValueChange={(v) => updateSettings({ readLongInParts: v })} testID="read-long-in-parts" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>Compress long chats automatically</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>When a chat nears the model's memory limit, older messages are summarized so it can keep going.</Text>
          </View>
          <Switch value={autoCompress} onValueChange={(v) => setPrefs({ autoCompress: v })} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 14 }}>
          <TouchableOpacity onPress={compress} disabled={busy} style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
            {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="minimize-2" size={15} color={colors.primary} />}
            <Text style={{ color: colors.primary, marginLeft: 6 }}>Compress now</Text>
          </TouchableOpacity>
          {!!conv.compactionSummary && (
            <>
              <TouchableOpacity onPress={() => setShowSummary((v) => !v)}><Text style={{ color: colors.textSecondary }}>{showSummary ? 'Hide summary' : 'View summary'}</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => contextCompactionService.clearSummary(convId)}><Text style={{ color: colors.textMuted }}>Undo</Text></TouchableOpacity>
            </>
          )}
        </View>
        {showSummary && !!conv.compactionSummary && (
          <Text selectable style={{ color: colors.textSecondary, fontSize: 13, marginTop: 8 }}>{conv.compactionSummary}</Text>
        )}
      </View>
    </View>
  );
};

const makeChipStyles = (colors: ReturnType<typeof useTheme>['colors']) => {
  const chip = { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 };
  return StyleSheet.create({
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 8 },
    chip: { ...chip, backgroundColor: colors.background },
    chipOn: { ...chip, backgroundColor: colors.primary },
    subTitle: { color: colors.text, fontWeight: '600', marginTop: 12 },
    hint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    chipText: { color: colors.text, fontSize: 13 },
    chipTextOn: { color: colors.background, fontSize: 13 },
  });
};
