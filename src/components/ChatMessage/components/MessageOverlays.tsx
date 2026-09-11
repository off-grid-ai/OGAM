import React from 'react';
import { useTheme } from '../../../theme';
import { CustomAlert, AlertState } from '../../CustomAlert';
import { ActionMenuSheet, EditSheet } from './ActionMenuSheet';
import { createStyles } from '../styles';
import type { Message } from '../../../types';

// The action sheets + alert overlays for a message. Split out of ChatMessage so the
// several visibility / capability decisions live here, not in ChatMessage's body.
interface MessageOverlaysProps {
  message: Message;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useTheme>['colors'];
  showActionMenu: boolean;
  isEditing: boolean;
  isUser: boolean;
  canEdit: boolean;
  canRetry: boolean;
  canGenerateImage: boolean;
  canSpeak: boolean;
  displayContent: string;
  alertState: AlertState;
  onCloseActionMenu: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onRetry: () => void;
  onGenerateImage: () => void;
  onSpeak: () => void;
  onSaveEdit: (text: string) => void;
  onCancelEdit: () => void;
  onCloseAlert: () => void;
}

export const MessageOverlays: React.FC<MessageOverlaysProps> = ({
  message, styles, colors, showActionMenu, isEditing, isUser,
  canEdit, canRetry, canGenerateImage, canSpeak, displayContent,
  alertState, onCloseActionMenu, onCopy, onEdit,
  onRetry, onGenerateImage, onSpeak, onSaveEdit, onCancelEdit, onCloseAlert,
}) => (
  <>
    <ActionMenuSheet
      visible={showActionMenu}
      onClose={onCloseActionMenu}
      isUser={isUser}
      canEdit={canEdit}
      canRetry={canRetry}
      canGenerateImage={canGenerateImage}
      canSpeak={canSpeak}
      styles={styles}
      onCopy={onCopy}
      onEdit={onEdit}
      onRetry={onRetry}
      onGenerateImage={onGenerateImage}
      onSpeak={onSpeak}
    />
    <EditSheet
      visible={isEditing}
      onClose={onCancelEdit}
      defaultValue={isUser ? message.content : displayContent}
      onSave={onSaveEdit}
      onCancel={onCancelEdit}
      resendsAfterSave={isUser}
      styles={styles}
      colors={colors}
    />
    <CustomAlert visible={alertState.visible} title={alertState.title}
      message={alertState.message} buttons={alertState.buttons} onClose={onCloseAlert} />
  </>
);
