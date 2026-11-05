/**
 * A knowledge-base file moving between this phone and a paired device.
 *
 * Pro (sync) owns the transfers and serves them through the `sync.knowledgeTransfers.*` hooks; the
 * knowledge-base list reads them to draw "Receiving from Mac · 40%" or "Couldn't sync to Mac: file
 * too large". Free builds register nothing, so the list draws no transfer rows.
 */
type KnowledgeDocumentTransferStatus =
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Why a transfer stopped, as one plain reason the row can say. */
type KnowledgeDocumentTransferFailure =
  | 'too_large'
  | 'unsupported'
  | 'checksum'
  | 'project_missing'
  | 'offline'
  | 'failed';

export interface KnowledgeDocumentTransfer {
  projectId: string;
  syncId: string;
  fileName: string;
  direction: 'send' | 'receive';
  deviceId: string;
  deviceName: string;
  bytesTransferred: number;
  totalBytes: number;
  status: KnowledgeDocumentTransferStatus;
  /** The transfer's own reason, kept for diagnostics. */
  error?: string;
  failure?: KnowledgeDocumentTransferFailure;
}

/** Identity of one transfer: one file, one peer, one direction. */
export const knowledgeDocumentTransferKey = (
  transfer: Pick<KnowledgeDocumentTransfer, 'direction' | 'deviceId' | 'syncId'>,
): string => `${transfer.direction}:${transfer.deviceId}:${transfer.syncId}`;

/** Read a transfer error into the one reason a person can act on. */
export function classifyKnowledgeDocumentTransferFailure(
  error: string | undefined,
): KnowledgeDocumentTransferFailure {
  const text = (error ?? '').toLowerCase();
  if (/exceeds|too large|size limit/.test(text)) return 'too_large';
  if (/checksum|verify|incomplete|out-of-order|invalid chunk/.test(text)) return 'checksum';
  if (/project/.test(text)) return 'project_missing';
  if (/invalid request|metadata|unsupported|mime/.test(text)) return 'unsupported';
  if (/disconnect|not connected|timed out|stopped/.test(text)) return 'offline';
  return 'failed';
}

const FAILURE_WORDS: Record<KnowledgeDocumentTransferFailure, string> = {
  too_large: 'file too large',
  unsupported: 'file type not supported',
  checksum: 'file arrived damaged',
  project_missing: 'project missing',
  offline: 'device went offline',
  failed: 'transfer failed',
};

/** 0–1 of the file moved. */
export function knowledgeDocumentTransferFraction(
  transfer: KnowledgeDocumentTransfer,
): number {
  if (transfer.status === 'completed') return 1;
  if (!transfer.totalBytes) return 0;
  return Math.min(1, transfer.bytesTransferred / transfer.totalBytes);
}

/** The short line a knowledge-base row shows for a transfer. */
export function knowledgeDocumentTransferLabel(
  transfer: KnowledgeDocumentTransfer,
): string {
  const send = transfer.direction === 'send';
  if (transfer.status === 'failed') {
    const reason = FAILURE_WORDS[transfer.failure ?? 'failed'];
    // Plain verbs: "send to" and "get from" say what happened; "sync" did not (hand test 51).
    return `Couldn't ${send ? 'send to' : 'get from'} ${transfer.deviceName}: ${reason}`;
  }
  const percent = Math.round(knowledgeDocumentTransferFraction(transfer) * 100);
  return `${send ? 'Sending to' : 'Receiving from'} ${transfer.deviceName} · ${percent}%`;
}

/** The transfer a document row speaks for: one still moving first, then one that failed. */
export function rowKnowledgeDocumentTransfer(
  transfers: readonly KnowledgeDocumentTransfer[],
  syncId: string,
): KnowledgeDocumentTransfer | undefined {
  const own = transfers.filter(transfer => transfer.syncId === syncId);
  return (
    own.find(({ status }) => status === 'active') ??
    own.find(({ status }) => status === 'failed')
  );
}

/** Files arriving for a project that this phone does not list yet. */
export function arrivingKnowledgeDocumentTransfers(
  transfers: readonly KnowledgeDocumentTransfer[],
  listedSyncIds: ReadonlySet<string>,
): KnowledgeDocumentTransfer[] {
  return transfers.filter(
    transfer =>
      transfer.direction === 'receive' && !listedSyncIds.has(transfer.syncId),
  );
}
