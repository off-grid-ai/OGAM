import React from 'react';
import { View, Image, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedEntry } from '../../components/AnimatedEntry';
import { useThemedStyles } from '../../theme';
import { GeneratedImage } from '../../types';
import { createStyles } from './styles';

interface GalleryGridItemProps {
  item: GeneratedImage;
  index: number;
  isSelectMode: boolean;
  isSelected: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

export const GalleryGridItem: React.FC<GalleryGridItemProps> = ({
  item,
  index,
  isSelectMode,
  isSelected,
  onPress,
  onLongPress,
}) => {
  const styles = useThemedStyles(createStyles);

  return (
    <AnimatedEntry index={index} staggerMs={40} maxItems={15}>
      <TouchableOpacity
        style={styles.gridItem}
        onPress={onPress}
        onLongPress={onLongPress}
        activeOpacity={0.8}
        accessibilityLabel={`Generated image ${index + 1}`}
        testID={`gallery-image-${index}`}
      >
        <Image
          source={{ uri: `file://${item.imagePath}` }}
          style={styles.gridImage}
        />
        {isSelectMode && (
          <View style={[styles.selectionOverlay, isSelected && styles.selectionOverlaySelected]}>
            <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
              {isSelected && <Icon name="check" size={14} color="#fff" />}
            </View>
          </View>
        )}
      </TouchableOpacity>
    </AnimatedEntry>
  );
};
