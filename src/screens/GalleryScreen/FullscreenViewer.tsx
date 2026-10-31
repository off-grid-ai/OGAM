import React from 'react';
import {
  View,
  Text,
  Image,
  Modal,
  ScrollView,
} from 'react-native';
import { TouchableOpacity } from '../../components/Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { GeneratedImage } from '../../types';
import { resolveDocumentPath } from '../../utils/resolveDocumentPath';
import { createStyles } from './styles';
import { formatDate } from './useGalleryActions';
import { useSlot, SLOTS } from '../../bootstrap/slotRegistry';

interface FullscreenViewerProps {
  image: GeneratedImage | null;
  showDetails: boolean;
  onClose: () => void;
  onToggleDetails: () => void;
  onSave: (image: GeneratedImage) => void;
  onDelete: (image: GeneratedImage) => void;
}

export const FullscreenViewer: React.FC<FullscreenViewerProps> = ({
  image,
  showDetails,
  onClose,
  onToggleDetails,
  onSave,
  onDelete,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // Video is Pro: "Animate this photo" fills this slot.
  const AnimateAction = useSlot(SLOTS.imageAnimateAction);
  const imageUri = image
    ? `file://${resolveDocumentPath(image.imagePath)}`
    : '';

  return (
    <Modal
      visible={!!image}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.viewerContainer}>
        <TouchableOpacity
          style={styles.viewerBackdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        {image && (
          <View style={styles.viewerContent}>
            {!showDetails && (
              <Image
                source={{ uri: imageUri }}
                style={styles.fullscreenImage}
                resizeMode="contain"
              />
            )}
            {showDetails && (
              <View style={styles.detailsSheet}>
                <View style={styles.detailsSheetHeader}>
                  <Text style={styles.detailsSheetTitle}>Image Details</Text>
                  <TouchableOpacity onPress={onToggleDetails}>
                    <Text style={styles.detailsSheetClose}>Done</Text>
                  </TouchableOpacity>
                </View>
                <Image
                  source={{ uri: imageUri }}
                  style={styles.detailsPreview}
                  resizeMode="contain"
                />
                <ScrollView style={styles.detailsContent}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>PROMPT</Text>
                    <Text style={styles.detailValue}>{image.prompt}</Text>
                  </View>
                  {image.negativePrompt ? (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>NEGATIVE</Text>
                      <Text style={styles.detailValue}>{image.negativePrompt}</Text>
                    </View>
                  ) : null}
                  <View style={styles.detailsMetaRow}>
                    <View style={styles.detailChip}>
                      <Text style={styles.detailChipText}>{image.steps} steps</Text>
                    </View>
                    <View style={styles.detailChip}>
                      <Text style={styles.detailChipText}>{image.width}x{image.height}</Text>
                    </View>
                    <View style={styles.detailChip}>
                      <Text style={styles.detailChipText}>Seed: {image.seed}</Text>
                    </View>
                  </View>
                  <Text style={styles.detailDate}>{formatDate(image.createdAt)}</Text>
                </ScrollView>
              </View>
            )}
            <View style={styles.viewerActions}>
              <TouchableOpacity
                style={[styles.viewerButton, showDetails && styles.viewerButtonActive]}
                onPress={onToggleDetails}
              >
                <Icon name="info" size={22} color={showDetails ? colors.primary : colors.text} />
                <Text style={showDetails ? styles.viewerButtonTextPrimary : styles.viewerButtonText}>
                  Info
                </Text>
              </TouchableOpacity>
              {AnimateAction && (
                <AnimateAction
                  imagePath={resolveDocumentPath(image.imagePath)}
                  conversationId={image.conversationId}
                  onStarted={onClose}
                  buttonStyle={styles.viewerButton}
                  textStyle={styles.viewerButtonText}
                  iconColor={colors.text}
                />
              )}
              <TouchableOpacity style={styles.viewerButton} onPress={() => onSave(image)}>
                <Icon name="download" size={22} color={colors.text} />
                <Text style={styles.viewerButtonText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.viewerButton} onPress={() => onDelete(image)}>
                <Icon name="trash-2" size={22} color={colors.error} />
                <Text style={styles.viewerButtonTextError}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.viewerButton} onPress={onClose}>
                <Icon name="x" size={22} color={colors.text} />
                <Text style={styles.viewerButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
};
