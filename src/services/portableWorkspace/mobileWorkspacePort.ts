import { BackupEngine, BundleError } from '@offgrid/sync/portable';
import type { WorkspaceTransferCounts } from '@offgrid/sync-react-native';
import { PortableWorkspaceMobileError } from '@offgrid/sync-react-native';
import type {
  ImportCollisionPolicy,
  PortableWorkspaceMobilePort,
  PortableWorkspaceSummary,
  WorkspaceTransferResult,
} from '@offgrid/sync-react-native';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { ragService } from '../rag';
import logger from '../../utils/logger';
import { MobileWorkspaceData } from './mobileWorkspaceData';
import { workspaceArchive, workspaceFiles, workspaceSink } from './nativeWorkspaceBoundary';
import { isWorkspaceRecoveryReady } from './importJournal';

const data = new MobileWorkspaceData(workspaceFiles);
const engine = new BackupEngine(data, workspaceArchive, workspaceSink, () => new Date().toISOString(), {
  collisionPolicy: 'keep-existing',
  cleanupReporter: {
    reportCleanupFailure: failure => logger.error('[WorkspaceTransfer] Cleanup failed', failure),
  },
});

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException('Workspace transfer cancelled', 'AbortError');
};

const requireRecoveryReady = (): void => {
  if (!isWorkspaceRecoveryReady()) {
    throw new PortableWorkspaceMobileError('Workspace transfer is unavailable until the app restarts safely.');
  }
};

const publicError = (error: unknown): never => {
  logger.error('[WorkspaceTransfer] Operation failed', error);
  if (error instanceof PortableWorkspaceMobileError) throw error;
  if (error instanceof BundleError) {
    throw new PortableWorkspaceMobileError('This workspace archive is invalid or unsupported.');
  }
  throw new PortableWorkspaceMobileError('The workspace archive could not be transferred.');
};

const allCounts = async (): Promise<WorkspaceTransferCounts> => {
  const conversations = useChatStore.getState().conversations;
  const projects = useProjectStore.getState().projects;
  let documents = 0;
  for (const project of projects) documents += (await ragService.getDocumentsByProject(project.id)).length;
  return {
    projects: projects.length,
    conversations: conversations.length,
    messages: conversations.reduce((sum, conversation) => sum + conversation.messages.length, 0),
    documents,
    attachments: conversations.reduce(
      (sum, conversation) => sum + conversation.messages.reduce((messageSum, message) => messageSum + (message.attachments?.length ?? 0), 0),
      0,
    ),
  };
};

export const mobileWorkspacePort: PortableWorkspaceMobilePort = {
  async readSummary(signal: AbortSignal): Promise<PortableWorkspaceSummary> {
    try {
      throwIfAborted(signal);
      requireRecoveryReady();
      const counts = await allCounts();
      throwIfAborted(signal);
      requireRecoveryReady();
      return counts;
    } catch (error) {
      return publicError(error);
    }
  },

  async exportWorkspace(signal: AbortSignal): Promise<WorkspaceTransferResult> {
    try {
      throwIfAborted(signal);
      requireRecoveryReady();
      const counts = await allCounts();
      const result = await engine.exportAll();
      throwIfAborted(signal);
      return result?.shared ? { status: 'completed', counts } : { status: 'cancelled' };
    } catch (error) {
      return publicError(error);
    }
  },

  async importWorkspace(
    policy: ImportCollisionPolicy,
    signal: AbortSignal,
  ): Promise<WorkspaceTransferResult> {
    if (policy !== 'keep-existing') {
      throw new PortableWorkspaceMobileError('Only keep-existing imports are available on this device.');
    }
    try {
      throwIfAborted(signal);
      const summary = await engine.import();
      // Native archive/SQLite work is not interruptible once apply starts. A
      // late UI abort suppresses observers in the controller, but must never
      // relabel a committed import as cancelled.
      return summary === null ? { status: 'cancelled' } : { status: 'completed', counts: summary };
    } catch (error) {
      return publicError(error);
    }
  },
};
