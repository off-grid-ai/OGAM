import React from 'react';
import { useTheme } from '../../../theme';
import { CustomAlert, AlertState } from '../../CustomAlert';
import { ActionMenuSheet, EditSheet, SelectTextSheet } from './ActionMenuSheet';
import { createStyles } from '../styles';
import type { Message } from '../../../types';

// The action sheets + alert overlays for a message. Split out of ChatMessage so the
// several visibility / capability decisions live here, not in ChatMessage's body.
interface MessageOverlaysProps {
  message: Message;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useTheme>['colors'];
  showActionMenu: boolean;
  showSelectText: boolean;
  isEditing: boolean;
  isUser: boolean;
  canEdit: boolean;
  canRetry: boolean;
  canDelete: boolean;
  canSaveToProject: boolean;
  canGenerateImage: boolean;
  canSpeak: boolean;
  showSelectTextAction: boolean;
  displayContent: string;
  alertState: AlertState;
  onCloseActionMenu: () => void;
  onCloseSelectText: () => void;
  onChangeEditText: (text: string) => void;
  onCopy: () => void;
  onEdit: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onSaveToProject: () => void;
  onGenerateImage: () => void;
  onSpeak: () => void;
  onSelectText: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onCloseAlert: () => void;
  extras?: { pinned: boolean; onPin: () => void; onSlides?: () => void };
}

export const MessageOverlays: React.FC<MessageOverlaysProps> = ({
  message, styles, colors, showActionMenu, showSelectText, isEditing, isUser,
  canEdit, canRetry, canDelete, canSaveToProject, canGenerateImage, canSpeak, showSelectTextAction, displayContent,
  alertState, onCloseActionMenu, onCloseSelectText, onChangeEditText, onCopy, onEdit,
  onRetry, onDelete, onSaveToProject, onGenerateImage, onSpeak, onSelectText, onSaveEdit, onCancelEdit, onCloseAlert, extras,
}) => (
  <>
    <ActionMenuSheet
      visible={showActionMenu}
      onClose={onCloseActionMenu}
      isUser={isUser}
      canEdit={canEdit}
      canRetry={canRetry}
      canDelete={canDelete}
      canSaveToProject={canSaveToProject}
      canGenerateImage={canGenerateImage}
      canSpeak={canSpeak}
      styles={styles}
      onCopy={onCopy}
      onEdit={onEdit}
      onRetry={onRetry}
      onDelete={onDelete}
      onSaveToProject={onSaveToProject}
      onGenerateImage={onGenerateImage}
      onSpeak={onSpeak}
      onSelectText={showSelectTextAction ? onSelectText : undefined}
      extras={extras}
    />
    <SelectTextSheet
      visible={showSelectText}
      onClose={onCloseSelectText}
      content={displayContent}
      styles={styles}
    />
    <EditSheet
      visible={isEditing}
      onClose={onCancelEdit}
      defaultValue={message.content}
      onChangeText={onChangeEditText}
      onSave={onSaveEdit}
      onCancel={onCancelEdit}
      styles={styles}
      colors={colors}
    />
    <CustomAlert visible={alertState.visible} title={alertState.title}
      message={alertState.message} buttons={alertState.buttons} onClose={onCloseAlert} />
  </>
);
