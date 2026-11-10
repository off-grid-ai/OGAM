import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { useChatStore } from '../stores/chatStore';
import { useAppStore } from '../stores/appStore';
import { estimateReply, fmtSec, roughTokens, useSpeedStats, ReplyEstimate } from '../atlasTools/speed';
const literalStyles = StyleSheet.create({
  s1: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 3 },
  s2: { fontSize: 11, marginLeft: 5 },
});


/** New text the model has to read this turn (earlier turns are already in its memory). */
function newPromptTokens(convId: string | null): number {
  const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
  const msgs = conv?.messages ?? [];
  const firstTurn = !msgs.some((m) => m.role === 'assistant' && !m.isSystemInfo);
  const counted = firstTurn ? msgs : msgs.slice(-1);
  let chars = 0;
  for (const m of counted) {
    if (m.role !== 'user' && !firstTurn) continue;
    chars += (m.content || '').length;
    for (const a of (m as any).attachments ?? []) chars += (a.textContent || '').length;
  }
  return roughTokens(chars) + (firstTurn ? 700 : 30); // instructions + tool list on the first turn
}

/**
 * Small line above the message box while a local model answers:
 * "Reading... first words in about 6 s", then "Writing... about 12 s left".
 * Learns from every reply, so it gets more accurate with use.
 */
export const ReplyEta: React.FC<{ remote?: boolean }> = ({ remote }) => {
  const { colors } = useTheme();
  const busy = useChatStore((s) => s.isStreaming || s.isThinking);
  const convId = useChatStore((s) => s.activeConversationId);
  const streamingFor = useChatStore((s) => s.streamingForConversationId);
  const outChars = useChatStore((s) => s.streamingMessage.length + s.streamingReasoningContent.length);
  const modelId = useAppStore((s) => s.activeModelId);
  const known = useSpeedStats((s) => !!(modelId && s.byModel[modelId]?.decode));
  const [, tick] = useState(0);
  const run = useRef<{ start: number; est: ReplyEstimate | null; firstAt: number } | null>(null);

  useEffect(() => {
    if (!busy) { run.current = null; return; }
    const st = useAppStore.getState().settings as any;
    const thinking = st?.thinkingEnabled ? (st.thinkingLevel || 'medium') : null;
    run.current = { start: Date.now(), est: estimateReply(modelId, newPromptTokens(convId), thinking), firstAt: 0 };
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (remote || !busy || !run.current || (streamingFor && streamingFor !== convId)) return null;
  const r = run.current;
  const elapsed = (Date.now() - r.start) / 1000;
  if (outChars > 0 && !r.firstAt) r.firstAt = Date.now();

  let text: string;
  if (!r.est) {
    text = known ? 'Working...' : 'Timing this model - estimates appear from the next answer.';
  } else if (!r.firstAt) {
    const left = r.est.firstWordsSec - elapsed;
    text = left > 1 ? `Reading... first words in about ${fmtSec(left)}` : 'Reading... (taking a little longer than usual)';
  } else {
    const writtenTokens = roughTokens(outChars);
    const left = (r.est.outTokens - writtenTokens) / r.est.decode;
    text = left > 2 ? `Writing... about ${fmtSec(left)} left for a typical answer` : 'Writing... (longer answer than usual)';
  }

  return (
    <View style={literalStyles.s1}>
      <Icon name="clock" size={11} color={colors.textMuted} />
      <Text style={[{ color: colors.textMuted }, literalStyles.s2]}>{text} · {Math.round(elapsed)} s so far</Text>
    </View>
  );
};
