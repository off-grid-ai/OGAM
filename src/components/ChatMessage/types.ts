import { DocumentCitation, MediaAttachment, Message } from '../../types';

export interface ChatMessageProps {
  /**
   * Suppress the assistant's PROSE, keeping thinking and tool cards.
   *
   * Voice mode: the words are delivered as a voice note, so printing them as chat text says the
   * same thing twice and turns a spoken turn into a wall of text. Tool calls still show, because
   * what the assistant DID is not something you want to listen to.
   */
  hideProse?: boolean;
  message: Message;
  /** Display-only context owned by this result and rendered at the top of its bubble. */
  supportingContext?: Message;
  isStreaming?: boolean;
  onImagePress?: (uri: string) => void;
  /** A page citation in an answer was tapped. */
  onCitationPress?: (source: DocumentCitation) => void;
  onCopy?: (content: string) => void;
  onRetry?: (message: Message) => void;
  /** Step to another version of this message (it has versions when threadVersions is set). */
  onSelectVersion?: (message: Message, direction: -1 | 1) => void;
  onEdit?: (message: Message, newContent: string) => void;
  onTranscribeAgain?: (
    message: Message,
    attachment: MediaAttachment,
  ) => Promise<void>;
  onGenerateImage?: (prompt: string) => void;
  showActions?: boolean;
  canGenerateImage?: boolean;
  canSpeak?: boolean;
  onSpeak?: () => void;
  showGenerationDetails?: boolean;
  animateEntry?: boolean;
  /** Extra element rendered at the end of the meta row (e.g. TTSButton) */
  metaExtra?: React.ReactNode;
}

// ParsedContent is owned by the util that produces it (utils/messageContent). Re-exported here
// so existing component imports (`./types`) keep working without utils depending on this module.
export type { ParsedContent } from '../../utils/messageContent';
