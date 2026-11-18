/**
 * The Pro tab: every Pro feature on this phone, one tap from its door. With Pro a row opens the
 * feature; without it, the row opens the feature's page in the info guide, which says what it does
 * and has Get Pro. The list is the guide's own (@offgrid/models), so the two never disagree.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { boostPromoCopy } from '@offgrid/models';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { TouchableOpacity } from '../components/Touchable';
import { ScreenHeader } from '../components/ScreenHeader';
import { ScreenField } from '../components/LivingField';
import { ProUpsellBanner } from '../components/settings/ProUpsellBanner';
import { CustomAlert, hideAlert, showAlert, initialAlertState, type AlertState } from '../components';
import { useOpenBoost } from '../hooks/useOpenBoost';
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
  const topics = useMemo(() => mobileGuideTopics(), []);
  const features = useMemo(() => topics.filter(t => t.pro && t.where === 'phone'), [topics]);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const openBoost = useOpenBoost('pro_tab', useCallback(
    () => setAlertState(showAlert("You're offline", 'Connect to the internet to see the offer.')),
    [],
  ));
  // Off Grid AI beyond this phone: Boost's cloud models, the desktop app and the browser extension.
  const elsewhere = [
    { key: 'boost', icon: 'cloud', title: 'Boost', line: BOOST.line, onPress: openBoost },
    ...([['computer', 'Desktop'], ['extension', 'Browser extension']] as const).flatMap(([id, title]) => {
      const topic = topics.find(t => t.id === id);
      const action = topic ? actionFor(topic) : null;
      return topic && action
        ? [{ key: id, icon: topic.icon, title, line: topic.tagline, onPress: action.onPress }]
        : [];
    }),
  ];

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
        <View style={styles.navSection}>
          {elsewhere.map((card, index) => (
            <TouchableOpacity
              key={card.key}
              style={[styles.navItem, index === elsewhere.length - 1 && styles.navItemLast]}
              onPress={card.onPress}
              accessibilityRole="button"
              accessibilityLabel={`${card.title}. ${card.line}`}
              testID={`pro-tab-card-${card.key}`}
            >
              <View style={styles.navItemIcon}>
                <Icon name={card.icon} size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>{card.title}</Text>
                <Text style={styles.navItemDesc} numberOfLines={2}>{card.line}</Text>
              </View>
              <Icon name="external-link" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </SafeAreaView>
  );
};

const BOOST = boostPromoCopy('phone');

