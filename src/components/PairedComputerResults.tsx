import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { withoutChatsOnDevice, type RemoteSearchOutcome, type RemoteSearchResult } from '@offgrid/rag';
import { Button } from './Button';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { formatWhen } from '../utils/localTime';
import type { RemoteServer } from '../types';

interface Props {
  computer: RemoteServer;
  outcome: RemoteSearchOutcome | 'searching' | null;
  /** Chats this phone already lists for the query, by id: shown once, there. */
  chatsListed: ReadonlySet<string>;
  /** Chats on this phone, by id: a computer result for one of them opens it here. */
  chatsOnPhone: ReadonlySet<string>;
  onOpenChat: (conversationId: string) => void;
  onRetry: () => void;
  onEnterKey: () => void;
}

/** Why the computer gave no results, and the one step that fixes it (null: no step on the phone). */
function problem(
  outcome: Exclude<RemoteSearchOutcome, { status: 'ok' }>,
  name: string,
): { line: string; action: 'retry' | 'key' | null } {
  switch (outcome.status) {
    case 'unreachable':
      return { line: `Can't reach ${name}. Check it's on and on the same network.`, action: 'retry' };
    case 'unauthorized':
      return { line: `${name} didn't accept this phone's key.`, action: 'key' };
    case 'pro-required':
      return { line: `Searching ${name} needs Off Grid AI Pro on it.`, action: null };
    case 'unsupported':
      return { line: `Update Off Grid AI on ${name} to search it.`, action: null };
    case 'failed':
      return { line: outcome.message, action: 'retry' };
  }
}

/** The paired computer's results for the search, in their own section under the phone's. */
export const PairedComputerResults: React.FC<Props> = ({
  computer, outcome, chatsListed, chatsOnPhone, onOpenChat, onRetry, onEnterKey,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  if (!outcome) return null;

  let body: React.ReactNode;
  if (outcome === 'searching') {
    body = <ActivityIndicator size="small" color={colors.textMuted} style={styles.spinner} testID="computer-search-searching" />;
  } else if (outcome.status === 'ok') {
    const results = withoutChatsOnDevice(outcome.results, chatsListed);
    body = results.length === 0
      ? <Text style={styles.line}>No matches.</Text>
      : results.map(result => (
        <ResultRow
          key={result.id}
          result={result}
          onPress={result.kind === 'chat' && chatsOnPhone.has(result.deepLinkId)
            ? () => onOpenChat(result.deepLinkId)
            : undefined}
        />
      ));
  } else {
    const { line, action } = problem(outcome, computer.name);
    body = (
      <View style={styles.problem} testID="computer-search-problem">
        <Text style={[styles.line, styles.problemLine]}>{line}</Text>
        {action === 'retry' ? (
          <Button
            title=""
            accessibilityLabel={`Search ${computer.name} again`}
            variant="ghost"
            size="small"
            onPress={onRetry}
            icon={<Icon name="refresh-cw" size={16} color={colors.text} />}
          />
        ) : null}
        {action === 'key' ? (
          <Button title="Enter key" variant="outline" size="small" onPress={onEnterKey} />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.section} testID="computer-search-section">
      <Text style={styles.header} accessibilityRole="header">{`On ${computer.name}`}</Text>
      {body}
    </View>
  );
};

const ResultRow: React.FC<{ result: RemoteSearchResult; onPress?: () => void }> = ({ result, onPress }) => {
  const styles = useThemedStyles(createStyles);
  const meta = [result.source, result.timestamp ? formatWhen(new Date(result.timestamp).toISOString()) : '']
    .filter(Boolean)
    .join(' · ');
  const content = (
    <>
      <Text style={styles.title} numberOfLines={1}>{result.title}</Text>
      {result.snippet ? <Text style={styles.snippet} numberOfLines={onPress ? 1 : 3}>{result.snippet}</Text> : null}
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
    </>
  );
  return onPress ? (
    <TouchableOpacity style={styles.row} onPress={onPress} accessibilityRole="button" testID={`computer-result-${result.id}`}>
      {content}
    </TouchableOpacity>
  ) : (
    <View style={styles.row} testID={`computer-result-${result.id}`}>{content}</View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  section: {
    marginTop: SPACING.md,
  },
  header: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
    marginBottom: SPACING.sm,
  },
  spinner: {
    alignSelf: 'flex-start' as const,
  },
  line: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
  },
  problem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  problemLine: {
    flex: 1,
  },
  row: {
    backgroundColor: colors.surface,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    borderRadius: 10,
    marginBottom: SPACING.md,
  },
  title: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
  },
  snippet: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
    marginTop: 1,
  },
  meta: {
    ...TYPOGRAPHY.metaSmall,
    color: colors.textMuted,
    marginTop: SPACING.xs / 2,
  },
});
