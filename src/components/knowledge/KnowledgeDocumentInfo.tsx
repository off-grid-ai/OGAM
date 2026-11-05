// A knowledge-base file's name and where its reading stands, on one line: "Reading 40%",
// "Indexing 120/480", "1,204 pages" or "Couldn't read", with a thin bar while it is not ready.
// Live progress comes from the document engine; after a restart the stored state fills in.
// A copy moving to or from a paired device speaks once the file's own reading is done:
// "Sending to Mac · 40%" or "Couldn't sync to Mac: file too large".

import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { DocumentProgress, StoredDocument } from '@offgrid/rag/documents';
import { useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { useDocumentProgressStore } from '../../services/documents/progressStore';
import { documentStore } from '../../services/documents/store';
import {
  knowledgeDocumentTransferFraction,
  knowledgeDocumentTransferLabel,
  type KnowledgeDocumentTransfer,
} from '../../services/sync/knowledgeDocumentTransfer';

const READING_LABEL = { reading: 'Reading', ocr: 'Scanning' } as const;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ReadingStatus {
  label: string;
  /** 0–1 while the file is not ready; null when there is nothing to show a bar for. */
  fraction: number | null;
  failed: boolean;
}

function readingStatus(
  live: DocumentProgress | undefined,
  stored: StoredDocument | null | undefined,
  hasDocument: boolean,
): ReadingStatus {
  if (!hasDocument || live?.phase === 'failed' || (!live && stored?.state === 'failed')) {
    return { label: "Couldn't read", fraction: null, failed: true };
  }
  if (live && live.phase !== 'ready') {
    const fraction = live.total ? Math.min(1, live.done / live.total) : 0;
    if (live.phase === 'indexing') {
      return {
        label: live.total
          ? `Indexing ${live.done.toLocaleString()}/${live.total.toLocaleString()}`
          : 'Indexing',
        fraction,
        failed: false,
      };
    }
    return {
      label: `${READING_LABEL[live.phase]} ${Math.min(99, Math.round(fraction * 100))}%`,
      fraction,
      failed: false,
    };
  }
  const ready = live?.phase === 'ready' || stored?.state === 'ready';
  const pages = live?.pageCount ?? stored?.pageCount ?? 0;
  if (ready) {
    return { label: `${pages.toLocaleString()} page${pages === 1 ? '' : 's'}`, fraction: null, failed: false };
  }
  return { label: 'Waiting', fraction: 0, failed: false };
}

/** A thin bar that eases to its value; nothing when there is no value to show. */
const ProgressLine: React.FC<{ fraction: number | null }> = ({ fraction }) => {
  const styles = useThemedStyles(createStyles);
  const width = useSharedValue(0);
  useEffect(() => {
    width.value = withTiming((fraction ?? 0) * 100, { duration: 250 });
  }, [fraction, width]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  if (fraction === null) return null;
  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, fillStyle]} />
    </View>
  );
};

/** A file arriving from a paired device before this phone lists it: name, where it stands, a bar. */
export const KnowledgeTransferInfo: React.FC<{
  transfer: KnowledgeDocumentTransfer;
  testID?: string;
}> = ({ transfer, testID }) => {
  const styles = useThemedStyles(createStyles);
  const failed = transfer.status === 'failed';
  return (
    <View testID={testID}>
      <View style={styles.line}>
        <Text style={[styles.name, failed && styles.metaFailed]} numberOfLines={1}>
          {transfer.fileName}
        </Text>
        <Text style={[styles.meta, styles.metaTransfer, failed && styles.metaFailed]} numberOfLines={1}>
          {knowledgeDocumentTransferLabel(transfer)}
        </Text>
      </View>
      <ProgressLine fraction={failed ? null : knowledgeDocumentTransferFraction(transfer)} />
    </View>
  );
};

export const KnowledgeDocumentInfo: React.FC<{
  name: string;
  size: number;
  /** Null for a file added before documents had ids whose file is gone. */
  documentId: string | null;
  /** A copy of this file moving to or from a paired device. */
  transfer?: KnowledgeDocumentTransfer;
  testID?: string;
}> = ({ name, size, documentId, transfer, testID }) => {
  const styles = useThemedStyles(createStyles);
  const live = useDocumentProgressStore((state) => (documentId ? state.byId[documentId] : undefined));
  const [stored, setStored] = useState<StoredDocument | null | undefined>(undefined);

  useEffect(() => {
    if (!documentId) return;
    let current = true;
    documentStore
      .getDocument(documentId)
      .then((document) => {
        if (current) setStored(document);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [documentId]);

  const status = readingStatus(live, stored, !!documentId);
  // The file's own reading speaks first; a transfer only once the file is ready here.
  const shownTransfer = status.failed || status.fraction !== null ? undefined : transfer;
  const label = shownTransfer
    ? knowledgeDocumentTransferLabel(shownTransfer)
    : `${formatFileSize(size)} · ${status.label}`;
  const failed = shownTransfer ? shownTransfer.status === 'failed' : status.failed;
  const fraction = shownTransfer
    ? shownTransfer.status === 'active'
      ? knowledgeDocumentTransferFraction(shownTransfer)
      : null
    : status.fraction;

  const statusText = (
    <Text
      style={[styles.meta, shownTransfer && styles.metaTransfer, failed && styles.metaFailed]}
      numberOfLines={1}
      testID={documentId ? `knowledge-document-status-${documentId}` : undefined}
    >
      {label}
    </Text>
  );

  return (
    <View testID={testID}>
      {/* A transfer line ("Couldn't sync to Mac") is a sentence: it gets its own line under the
          name, so it never cuts the file's name short (hand test 48: "deskto…"). */}
      <View style={styles.line}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {shownTransfer ? null : statusText}
      </View>
      {shownTransfer ? statusText : null}
      <ProgressLine fraction={fraction} />
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  line: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  name: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    flexShrink: 1,
  },
  meta: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textMuted,
    marginLeft: 'auto' as const,
  },
  /** A transfer line can be long ("Couldn't sync to iPhone: file too large"); it shares the row. */
  metaTransfer: {
    marginLeft: 0,
    marginTop: 2,
  },
  metaFailed: {
    color: colors.error,
  },
  track: {
    height: 2,
    marginTop: SPACING.xs,
    borderRadius: 1,
    backgroundColor: colors.border,
    overflow: 'hidden' as const,
  },
  fill: {
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.primary,
  },
});
