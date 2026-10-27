import React, { useMemo } from 'react';
import { useNavigation } from '@react-navigation/native';
import { PairedComputerResults } from './PairedComputerResults';
import { usePairedComputerSearch } from '../hooks/usePairedComputerSearch';
import type { Conversation } from '../types';

interface Props {
  /** What the person typed. Empty means the computer is not asked. */
  query: string;
  /** Every chat on this phone, in order of recent activity. */
  conversations: readonly Conversation[];
  /** The chats this phone is already listing for `query`: shown once, there. */
  listed: readonly Conversation[];
  onOpenChat: (conversationId: string) => void;
}

/**
 * The paired computer's half of chat search, under the phone's own results.
 *
 * It owns the search and the chat-id sets so the list screen does not: the screen passes what it is
 * showing and what it holds, and nothing else about the computer reaches it.
 */
export const PairedComputerSearchFooter: React.FC<Props> = ({
  query,
  conversations,
  listed,
  onOpenChat,
}) => {
  const navigation = useNavigation<any>();
  const search = usePairedComputerSearch(query);
  const chatsListed = useMemo(
    () => new Set(query.trim() ? listed.map(conversation => conversation.id) : []),
    [query, listed],
  );
  const chatsOnPhone = useMemo(
    () => new Set(conversations.map(conversation => conversation.id)),
    [conversations],
  );
  if (!search.computer) return null;
  return (
    <PairedComputerResults
      computer={search.computer}
      outcome={search.outcome}
      chatsListed={chatsListed}
      chatsOnPhone={chatsOnPhone}
      onOpenChat={onOpenChat}
      onRetry={search.retry}
      onEnterKey={() =>
        navigation.navigate('RemoteServerEditor', {
          serverId: search.computer.id,
          needsKey: true,
        })
      }
    />
  );
};
