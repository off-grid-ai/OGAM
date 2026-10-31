import React from 'react';
import { View, Text, Image, Linking, StyleSheet } from 'react-native';
import { TouchableOpacity } from './Touchable';
import { TYPOGRAPHY, WEDNESDAY_URL } from '../constants';

export const MadeWithLove: React.FC = () => (
  <TouchableOpacity onPress={() => Linking.openURL(WEDNESDAY_URL)} style={styles.container}>
    <View style={styles.row}>
      <Text style={styles.text}>
        {'made with '}
        <Text style={styles.heart}>{'♥'}</Text>
        {' by '}
      </Text>
      <Image source={require('../assets/wednesday_logo.png')} style={styles.logo} />
      <Text style={styles.text}>{'Wednesday'}</Text>
    </View>
  </TouchableOpacity>
);

const TEXT_COLOR = '#8C8C8C';
const HEART_COLOR = '#FF0000';

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: 16 },
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { ...(TYPOGRAPHY.bodySmall as object), color: TEXT_COLOR },
  heart: { color: HEART_COLOR },
  logo: { width: 20, height: 20, resizeMode: 'contain', marginHorizontal: 4 },
});
