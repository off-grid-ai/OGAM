/**
 * The Pro tab: every Pro feature on this phone, one tap from its door. With Pro a row opens the
 * feature; without it, the row opens the feature's page in the info guide, which says what it does
 * and has Get Pro. The list is the guide's own (@offgrid/models), so the two never disagree.
 */
import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { TouchableOpacity } from '../components/Touchable';
import { ScreenHeader } from '../components/ScreenHeader';
import { ScreenField } from '../components/LivingField';
import { ProUpsellBanner } from '../components/settings/ProUpsellBanner';
import { useTheme, useThemedStyles } from '../theme';
import { useAppStore } from '../stores';
import { selectHasProAccess } from '../stores/proAccessSlice';
import { useGetPro } from '../hooks/useGetPro';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { SCROLL_DEPTH_PROPS } from '../constants/scrollDepth';
import type { RootStackParamList } from '../navigation/types';
import { mobileGuideTopics } from './GuideScreen/guideTopics';
import { useGuideAction } from './GuideScreen/useGuideAction';
import { createStyles } from './SettingsScreen.styles';

export const ProTabScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const hasPro = useAppStore(selectHasProAccess);
  const getPro = useGetPro();
  const focusTrigger = useFocusTrigger();
  const actionFor = useGuideAction();
  const features = useMemo(() => mobileGuideTopics().filter(t => t.pro && t.where === 'phone'), []);

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="pro-tab-screen">
      <ScreenField />
      <ScreenHeader title="Pro" variant="tab" />
      <ScrollView {...SCROLL_DEPTH_PROPS} style={styles.scrollView} contentContainerStyle={styles.content}>
        {hasPro ? null : <ProUpsellBanner trigger={focusTrigger} onGetPro={() => getPro('pro-tab')} />}
        <View style={styles.navSection}>
          {features.map((topic, index) => {
            const action = actionFor(topic);
            const opens = hasPro && action && !action.locked;
            return (
              <TouchableOpacity
                key={topic.id}
                style={[styles.navItem, index === features.length - 1 && styles.navItemLast]}
                onPress={() => (opens ? action.onPress() : navigation.navigate('GuideTopic', { id: topic.id }))}
                accessibilityRole="button"
                accessibilityLabel={`${topic.label}. ${topic.tagline}`}
                testID={`pro-tab-${topic.id}`}
              >
                <View style={styles.navItemIcon}>
                  <Icon name={topic.icon} size={16} color={colors.textSecondary} />
                </View>
                <View style={styles.navItemContent}>
                  <Text style={styles.navItemTitle}>{topic.label}</Text>
                  <Text style={styles.navItemDesc} numberOfLines={2}>{topic.tagline}</Text>
                </View>
                <Icon name={opens ? 'chevron-right' : 'info'} size={16} color={colors.textMuted} />
              </TouchableOpacity>
            );
          })}
        </View>
        {hasPro ? (
          <TouchableOpacity
            style={[styles.navSection, styles.navItem, styles.navItemLast]}
            onPress={() => navigation.navigate('ProDetail')}
            accessibilityRole="button"
            accessibilityLabel="Your licence"
            testID="pro-tab-licence"
          >
            <View style={styles.navItemIcon}>
              <Icon name="award" size={16} color={colors.textSecondary} />
            </View>
            <View style={styles.navItemContent}>
              <Text style={styles.navItemTitle}>Your licence</Text>
              <Text style={styles.navItemDesc}>Devices, renewal and restore</Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};
