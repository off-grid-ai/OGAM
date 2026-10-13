import React, { useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { Button } from '../../components/Button';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedEntry } from '../../components/AnimatedEntry';
import { useThemedStyles } from '../../theme';
import { GeneratedImage } from '../../types';
import { resolveDocumentPath } from '../../utils/resolveDocumentPath';
import { createStyles } from './styles';

interface GalleryGridItemProps {
  item: GeneratedImage;
  index: number;
  isSelectMode: boolean;
  isSelected: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onRemove: () => void;
}

export const GalleryGridItem: React.FC<GalleryGridItemProps> = ({
  item,
  index,
  isSelectMode,
  isSelected,
  onPress,
  onLongPress,
  onRemove,
}) => {
  const styles = useThemedStyles(createStyles);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const imageState = failed ? 'unavailable' : loaded ? 'loaded' : 'loading';
  const imageUri = `file://${resolveDocumentPath(item.imagePath)}`;

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [imageUri]);

  return (
    <AnimatedEntry index={index} staggerMs={40} maxItems={15}>
      <TouchableOpacity
        style={styles.gridItem}
        onPress={failed && !isSelectMode ? onRemove : onPress}
        onLongPress={onLongPress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`Generated image ${imageState}: ${item.prompt}`}
        testID={`gallery-image-${item.id}`}
      >
        {failed ? (
          <View style={styles.unavailableImage}>
            <Text style={styles.unavailableText}>Image is not on this device</Text>
            <Button title="Remove" variant="ghost" size="small" onPress={onRemove} />
          </View>
        ) : (
          <Image
            source={{ uri: imageUri }}
            style={styles.gridImage}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        )}
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
