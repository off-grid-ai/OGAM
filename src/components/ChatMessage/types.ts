import { Message } from '../../types';

export interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  onImagePress?: (uri: string) => void;
  onCopy?: (content: string) => void;
  onRetry?: (message: Message) => void;
  onEdit?: (message: Message, newContent: string) => void;
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
