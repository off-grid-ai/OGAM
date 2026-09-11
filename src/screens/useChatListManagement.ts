import { useRef, useState } from 'react';
import { workflowFailureMessage } from '@offgrid/application';
import type { AlertState } from '../components/CustomAlert';
import { hideAlert, showAlert } from '../components/CustomAlert';
import { applicationFacade } from '../services/applicationFacade';

interface UseChatListManagementInput {
  setAlertState: React.Dispatch<React.SetStateAction<AlertState>>;
}

export function useChatListManagement({
  setAlertState,
}: UseChatListManagementInput) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedConversationIds, setSelectedConversationIds] = useState(
    () => new Set<string>(),
  );
  const [deletingConversationId, setDeletingConversationId] = useState<
    string | null
  >(null);
  const deleteInFlight = useRef(false);

  const leaveSelectionMode = () => {
    setIsSelecting(false);
    setSelectedConversationIds(new Set());
  };

  const changeSearchQuery = (value: string) => {
    setSearchQuery(value);
    setSelectedConversationIds(new Set());
  };

  const toggleConversation = (conversationId: string) => {
    setSelectedConversationIds(current => {
      const next = new Set(current);
      if (next.has(conversationId)) {
        next.delete(conversationId);
      } else {
        next.add(conversationId);
      }
      return next;
    });
  };

  const deleteSelectedChats = async (conversationIds: readonly string[]) => {
    if (deleteInFlight.current) return;
    deleteInFlight.current = true;
    setAlertState(hideAlert());
    const failures: Array<{ id: string; message: string }> = [];

    try {
      for (const conversationId of conversationIds) {
        setDeletingConversationId(conversationId);
        try {
          const outcome =
            await applicationFacade().workflows.deleteConversation(
              conversationId,
            );
          if (!outcome.ok) {
            failures.push({
              id: conversationId,
              message: workflowFailureMessage(outcome.failure),
            });
          }
        } catch (error) {
          failures.push({
            id: conversationId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      setDeletingConversationId(null);
      deleteInFlight.current = false;
    }

    if (failures.length === 0) {
      leaveSelectionMode();
      return;
    }

    setSelectedConversationIds(new Set(failures.map(failure => failure.id)));
    setAlertState(
      showAlert(
        failures.length === conversationIds.length
          ? 'Chats Not Deleted'
          : 'Some Chats Not Deleted',
        failures.length === 1
          ? 'One chat could not be deleted. Try again.'
          : `${failures.length} chats could not be deleted. Try again.`,
      ),
    );
  };

  const handleBulkDeleteAction = () => {
    if (deleteInFlight.current) return;

    if (!isSelecting) {
      setIsSelecting(true);
      return;
    }

    const selectedIds = [...selectedConversationIds];
    if (selectedIds.length === 0) {
      leaveSelectionMode();
      return;
    }

    setAlertState(
      showAlert(
        'Delete Chats',
        `Delete ${selectedIds.length} selected ${
          selectedIds.length === 1 ? 'chat' : 'chats'
        }? This will also delete all images generated in the selected ${
          selectedIds.length === 1 ? 'chat' : 'chats'
        }.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => deleteSelectedChats(selectedIds),
          },
        ],
      ),
    );
  };

  return {
    searchQuery,
    isSelecting,
    deletingConversationId,
    isDeleting: deletingConversationId !== null,
    selectedConversationIds,
    changeSearchQuery,
    toggleConversation,
    handleBulkDeleteAction,
  };
}
