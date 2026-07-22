import React, { useEffect, useMemo } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { SpotlightTourProvider } from 'react-native-spotlight-tour';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { triggerHaptic } from '../utils/haptics';
import { useAppStore } from '../stores';
import { createSpotlightSteps } from '../components/onboarding/spotlightConfig';
import {
  OnboardingScreen,
  ModelDownloadScreen,
  HomeScreen,
  ModelsScreen,
  ChatScreen,
  SettingsScreen,
  ProjectsScreen,
  ChatsListScreen,
  ProjectDetailScreen,
  ProjectEditScreen,
  ProjectChatsScreen,
  KnowledgeBaseScreen,
  DocumentPreviewScreen,
  DownloadManagerScreen,
  ModelSettingsScreen,
  ExperimentalFeaturesScreen,
  DeviceInfoScreen,
  StorageSettingsScreen,
  SecuritySettingsScreen,
  GalleryScreen,
  RemoteServersScreen,
  ProDetailScreen,
  AboutScreen,
  ToolsScreen,
} from '../screens';
import {
  RootStackParamList,
  MainTabParamList,
} from './types';
import { useRegisteredScreens } from './screenRegistry';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

// Animated tab icon with scale spring on focus
const TAB_ICON_MAP: Record<string, string> = {
  HomeTab: 'home',
  ChatsTab: 'message-circle',
  ProjectsTab: 'folder',
  ModelsTab: 'cpu',
  SettingsTab: 'settings',
};

const TabBarIcon: React.FC<{ name: string; focused: boolean }> = ({ name, focused }) => {
  const { colors } = useTheme();
  const tabStyles = useThemedStyles(createTabBarStyles);
  const scale = useSharedValue(focused ? 1.1 : 1);

  useEffect(() => {
    scale.value = withSpring(focused ? 1.1 : 1, { damping: 15, stiffness: 150 });

  }, [focused]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={tabStyles.iconContainer}>
      <Animated.View style={animatedStyle}>
        <Icon
          name={TAB_ICON_MAP[name] || 'circle'}
          size={22}
          color={focused ? colors.primary : colors.textMuted}
        />
      </Animated.View>
      {focused && <View style={tabStyles.focusDot} />}
    </View>
  );
};

const createTabBarStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  iconContainer: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  focusDot: {
    position: 'absolute' as const,
    top: -6,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
});

const mainTabsStyles = StyleSheet.create({
  container: { flex: 1 },
});

// Main Tab Navigator
const MainTabs: React.FC = () => {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 20);
  const tabBarHeight = 60 + bottomInset;

  return (
    <View style={mainTabsStyles.container}>
      <Tab.Navigator
        backBehavior="history"
        screenOptions={({ route }) => ({
          headerShown: false,
          animation: 'fade',
          lazy: true,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderTopWidth: 1,
            height: tabBarHeight,
            paddingBottom: bottomInset,
            paddingTop: 10,
            ...shadows.medium,
          },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarIcon: ({ focused }) => (
            <TabBarIcon name={route.name} focused={focused} />
          ),
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '500' as const,
          },
        })}
      >
        <Tab.Screen
          name="HomeTab"
          component={HomeScreen}
          options={{ tabBarLabel: 'Home', tabBarButtonTestID: 'home-tab' }}
          listeners={() => ({
            tabPress: () => { triggerHaptic('selection'); },
          })}
        />
        <Tab.Screen
          name="ChatsTab"
          component={ChatsListScreen}
          options={{ tabBarLabel: 'Chats', tabBarButtonTestID: 'chats-tab' }}
          listeners={() => ({
            tabPress: () => { triggerHaptic('selection'); },
          })}
        />
        <Tab.Screen
          name="ProjectsTab"
          component={ProjectsScreen}
          options={{ tabBarLabel: 'Projects', tabBarButtonTestID: 'projects-tab' }}
          listeners={() => ({
            tabPress: () => { triggerHaptic('selection'); },
          })}
        />
        <Tab.Screen
          name="ModelsTab"
          component={ModelsScreen}
          options={{ tabBarLabel: 'Models', tabBarButtonTestID: 'models-tab' }}
          listeners={() => ({
            tabPress: () => { triggerHaptic('selection'); },
          })}
        />
        <Tab.Screen
          name="SettingsTab"
          component={SettingsScreen}
          options={{ tabBarLabel: 'Settings', tabBarButtonTestID: 'settings-tab' }}
          listeners={() => ({
            tabPress: () => { triggerHaptic('selection'); },
          })}
        />
      </Tab.Navigator>
    </View >
  );
};

// Root Navigator — SpotlightTourProvider wraps entire stack so all screens
// (both tab screens and RootStack screens) can use useSpotlightTour()
export const AppNavigator: React.FC = () => {
  const { colors, isDark } = useTheme();
  const hasCompletedOnboarding = useAppStore((s) => s.hasCompletedOnboarding);
  const downloadedModels = useAppStore((s) => s.downloadedModels);
  const steps = useMemo(() => createSpotlightSteps(), []);
  // Reactive: screens registered at runtime (Pro activation re-runs loadProFeatures)
  // mount as real routes live, so navigate('McpServers') works without an app restart.
  const registeredScreens = useRegisteredScreens();

  // Determine initial route
  let initialRoute: keyof RootStackParamList = 'Onboarding';
  if (hasCompletedOnboarding) {
    initialRoute = downloadedModels.length > 0 ? 'Main' : 'ModelDownload';
  }

  return (
    <SpotlightTourProvider
      steps={steps}
      overlayColor="black"
      overlayOpacity={isDark ? 0.78 : 0.62}
      onBackdropPress="stop"
      motion="fade"
      shape={{ type: 'rectangle', padding: 8 }}
    >
      <RootStack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'slide_from_right',
        }}
      >
        <RootStack.Screen name="Onboarding" component={OnboardingScreen} />
        <RootStack.Screen name="ModelDownload" component={ModelDownloadScreen} />
        <RootStack.Screen name="Main" component={MainTabs} />
        <RootStack.Screen name="Chat" component={ChatScreen} />
        <RootStack.Screen name="ProjectDetail" component={ProjectDetailScreen} />
        <RootStack.Screen name="ProjectChats" component={ProjectChatsScreen} />
        <RootStack.Screen
          name="ProjectEdit"
          component={ProjectEditScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <RootStack.Screen name="KnowledgeBase" component={KnowledgeBaseScreen} />
        <RootStack.Screen name="DocumentPreview" component={DocumentPreviewScreen} />
        <RootStack.Screen name="ModelSettings" component={ModelSettingsScreen} />
        <RootStack.Screen name="ExperimentalFeatures" component={ExperimentalFeaturesScreen} />
        <RootStack.Screen name="RemoteServers" component={RemoteServersScreen} />
        <RootStack.Screen name="DeviceInfo" component={DeviceInfoScreen} />
        <RootStack.Screen name="StorageSettings" component={StorageSettingsScreen} />
        <RootStack.Screen name="SecuritySettings" component={SecuritySettingsScreen} />
        <RootStack.Screen
          name="ProDetail"
          component={ProDetailScreen}
          options={{ headerShown: false, animation: 'slide_from_bottom' }}
        />
        <RootStack.Screen
          name="About"
          component={AboutScreen}
          options={{ headerShown: false }}
        />
        <RootStack.Screen name="Tools" component={ToolsScreen} />
        <RootStack.Screen
          name="DownloadManager"
          component={DownloadManagerScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <RootStack.Screen
          name="Gallery"
          component={GalleryScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        {registeredScreens.map(s => (
          <RootStack.Screen key={s.name} name={s.name as any} component={s.component} />
        ))}
      </RootStack.Navigator>
    </SpotlightTourProvider>
  );
};
