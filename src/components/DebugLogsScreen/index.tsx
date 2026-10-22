/**
 * Debug Logs Screen
 * Simple modal showing captured debug logs with copy and clear options
 */

import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Clipboard,
  Share,
  SafeAreaView,
  Modal,
} from 'react-native';
import { LIST_CLIPPING_PROPS } from '../../constants/listClipping';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { useDebugLogsStore } from '../../stores/debugLogsStore';
import { createStyles } from './styles';

interface DebugLogsScreenProps {
  visible: boolean;
  onClose: () => void;
  syncOnly?: boolean;
}

export const DebugLogsScreen: React.FC<DebugLogsScreenProps> = ({ visible, onClose, syncOnly = false }) => {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const { logs, clearLogs } = useDebugLogsStore();
  const [syncFilter, setSyncFilter] = React.useState<'state' | 'files' | 'startup' | 'all'>('state');
  const syncLogs = syncOnly
    ? logs.filter(log => /\[(?:BOOT-SYNC|StateSync|SYNC_DIAGNOSTIC|REPAIR)\]/i.test(log.message))
    : logs;
  const visibleLogs = !syncOnly || syncFilter === 'all'
    ? syncLogs
    : syncLogs.filter(log => {
        if (syncFilter === 'state') return /\[StateSync\]/i.test(log.message);
        if (syncFilter === 'files') return /\[SYNC_DIAGNOSTIC\]/i.test(log.message);
        return /\[(?:BOOT-SYNC|REPAIR)\]/i.test(log.message);
      });

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const getLogColor = (level: string) => {
    switch (level) {
      case 'error':
        return theme.colors.error;
      case 'warn':
        return theme.colors.trending;
      default:
        return theme.colors.textSecondary;
    }
  };

  const handleCopyAllLogs = async () => {
    const logsText = visibleLogs
      .map(
        (log: any) =>
          `[${formatTime(log.timestamp)}] ${log.level.toUpperCase()}: ${log.message}`
      )
      .join('\n');

    try {
      await Clipboard.setString(logsText);
      // Show feedback (could use toast here)
    } catch {
      // Failed to copy
    }
  };

  const handleShare = async () => {
    const logsText = visibleLogs
      .map(
        (log: any) =>
          `[${formatTime(log.timestamp)}] ${log.level.toUpperCase()}: ${log.message}`
      )
      .join('\n');

    try {
      await Share.share({
        message: logsText,
        title: 'Debug Logs',
      });
    } catch {
      // Cancelled
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>{syncOnly ? 'Sync Debug Logs' : 'Debug Logs'}</Text>
            <Text style={styles.subtitle}>{visibleLogs.length} log entries</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
            <Icon name="x" size={24} color={theme.colors.text} />
          </TouchableOpacity>
        </View>

        {syncOnly && (
          <View style={styles.actionBar}>
            {(['state', 'files', 'startup', 'all'] as const).map(filter => (
              <TouchableOpacity
                key={filter}
                accessibilityRole="button"
                accessibilityState={{ selected: syncFilter === filter }}
                onPress={() => setSyncFilter(filter)}
                style={[styles.actionButton, syncFilter === filter && styles.filterSelected]}
              >
                <Text style={styles.actionButtonText}>
                  {{ state: 'State ops', files: 'Files', startup: 'Startup', all: 'All' }[filter]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actionBar}>
          <TouchableOpacity style={styles.actionButton} onPress={handleCopyAllLogs}>
            <Icon name="copy" size={16} color={theme.colors.primary} style={styles.actionIcon} />
            <Text style={styles.actionButtonText}>Copy All</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
            <Icon name="share-2" size={16} color={theme.colors.primary} style={styles.actionIcon} />
            <Text style={styles.actionButtonText}>Share</Text>
          </TouchableOpacity>

          {!syncOnly && <TouchableOpacity style={styles.actionButton} onPress={clearLogs}>
            <Icon name="trash-2" size={16} color={theme.colors.error} style={styles.actionIcon} />
            <Text style={[styles.actionButtonText, { color: theme.colors.error }]}>Clear</Text>
          </TouchableOpacity>}
        </View>

        {/* Logs List */}
        {visibleLogs.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{syncOnly ? 'No sync debug logs yet' : 'No logs yet'}</Text>
          </View>
        ) : (
          <FlatList
            {...LIST_CLIPPING_PROPS}
            // Transformed list (inverted / animated pager): keep the iOS default, no clipping.
            removeClippedSubviews={false}
            data={visibleLogs}
            keyExtractor={(_, index) => `${index}`}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }: { item: any }) => (
              <View style={styles.logEntry}>
                <Text style={styles.logTime}>{formatTime(item.timestamp)}</Text>
                <Text style={[styles.logLevel, { color: getLogColor(item.level) }]}>
                  {item.level.toUpperCase()}
                </Text>
                <Text style={[styles.logMessage, { color: theme.colors.text }]}>
                  {item.message}
                </Text>
              </View>
            )}
            inverted
          />
        )}
      </SafeAreaView>
    </Modal>
  );
};
