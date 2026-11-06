import React, { useRef, useState } from 'react';
import { View, Text, Image, ScrollView, StatusBar } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { TouchableOpacity } from '../../components/Touchable';
import { AppSheet } from '../../components/AppSheet';
import { CustomAlert, hideAlert, initialAlertState, type AlertState } from '../../components/CustomAlert';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import type { RootStackParamList } from '../../navigation/types';
import { resolveDocumentPath } from '../../utils/resolveDocumentPath';
import { useSlot, SLOTS } from '../../bootstrap/slotRegistry';
import { createStyles, VIEWER_INK } from './styles';
import { formatDate } from './useGalleryActions';
import { askDeleteImage, saveImage } from './galleryMedia';

type GalleryImageRoute = RouteProp<RootStackParamList, 'GalleryImage'>;

/**
 * One Gallery image, full screen, as its own route: Back and the swipe close it. Its actions and details
 * sit in a sheet over the picture, opened by a tap on the picture or on More.
 */
export const GalleryImageScreen: React.FC = () => {
  const navigation = useNavigation();
  const { imageId } = useRoute<GalleryImageRoute>().params;
  const image = useAppStore(state => state.generatedImages.find(item => item.id === imageId));
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { top } = useSafeAreaInsets();
  // Video is Pro: "Animate this photo" fills this slot.
  const AnimateAction = useSlot(SLOTS.imageAnimateAction);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  // Delete's confirmation opens once the sheet has fully closed, so two sheets never meet mid-dismiss.
  const afterClose = useRef<(() => void) | null>(null);
  const closeSheetThen = (action: () => void) => {
    afterClose.current = action;
    setSheetOpen(false);
  };
  const runAfterClose = () => {
    const action = afterClose.current;
    afterClose.current = null;
    action?.();
  };

  return (
    <View style={styles.imageScreen} testID="gallery-image-screen">
      <StatusBar barStyle="light-content" />
      {image ? (
        <TouchableOpacity
          style={styles.imageScreenPicture}
          activeOpacity={1}
          onPress={() => setSheetOpen(true)}
          accessibilityRole="imagebutton"
          accessibilityLabel={image.prompt}
          accessibilityHint="Shows details and actions"
          testID="gallery-image-picture"
        >
          <Image
            source={{ uri: `file://${resolveDocumentPath(image.imagePath)}` }}
            style={styles.imageScreenPicture}
            resizeMode="contain"
          />
        </TouchableOpacity>
      ) : (
        <Text style={styles.imageScreenGone}>This image is no longer in your Gallery.</Text>
      )}
      <View style={[styles.imageScreenBar, { paddingTop: top }]}>
        <TouchableOpacity
          style={styles.imageScreenBarButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="gallery-image-back"
        >
          <Icon name="arrow-left" size={24} color={VIEWER_INK} />
        </TouchableOpacity>
        {image ? (
          <TouchableOpacity
            style={styles.imageScreenBarButton}
            onPress={() => setSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Details and actions"
            testID="gallery-image-more"
          >
            <Icon name="more-horizontal" size={24} color={VIEWER_INK} />
          </TouchableOpacity>
        ) : null}
      </View>

      {image ? (
        <AppSheet
          sheet="gallery-image"
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onClosed={runAfterClose}
          enableDynamicSizing
          title="Image"
        >
          <View style={styles.imageSheetActions}>
            {AnimateAction && (
              <AnimateAction
                imagePath={resolveDocumentPath(image.imagePath)}
                conversationId={image.conversationId}
                onStarted={() => setSheetOpen(false)}
                buttonStyle={styles.imageSheetAction}
                textStyle={styles.imageSheetActionText}
                iconColor={colors.text}
              />
            )}
            <TouchableOpacity
              style={styles.imageSheetAction}
              // Over the open sheet: iOS presents the share sheet from it. Closing it first left nothing to
              // present from, and the share sheet never showed (iPhone, 2026-11-06).
              onPress={() => { saveImage(image, setAlertState); }}
              accessibilityRole="button"
              accessibilityLabel="Save"
            >
              <Icon name="download" size={22} color={colors.text} />
              <Text style={styles.imageSheetActionText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.imageSheetAction}
              onPress={() => closeSheetThen(() => askDeleteImage(image, setAlertState, () => navigation.goBack()))}
              accessibilityRole="button"
              accessibilityLabel="Delete"
            >
              <Icon name="trash-2" size={22} color={colors.error} />
              <Text style={[styles.imageSheetActionText, styles.imageSheetActionDestructive]}>Delete</Text>
            </TouchableOpacity>
          </View>
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
        </AppSheet>
      ) : null}
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </View>
  );
};
