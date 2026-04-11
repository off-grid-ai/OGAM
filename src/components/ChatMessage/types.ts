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

export interface ParsedContent {
  thinking: string | null;
  response: string;
  isThinkingComplete: boolean;
  thinkingLabel?: string;
}
