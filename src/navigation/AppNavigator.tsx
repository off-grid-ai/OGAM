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
import { sectionColor } from '../theme/appearance';
import type { ThemeColors, ThemeShadows } from '../theme';
import { triggerHaptic } from '../services/haptics';
import { useAppStore } from '../stores';
import { createSpotlightSteps } from '../components/onboarding/spotlightConfig';
import {
  OnboardingScreen,
  ModelDownloadScreen,
  HomeScreen,
  ModelsScreen,
  ChatScreen,
  SettingsScreen,
  ChatsListScreen,
  ProjectDetailScreen,
  ProjectEditScreen,
  AgentEditScreen,
  LearningScreen,
  EmergencyScreen,
  OfflineLibraryScreen,
  SurvivalManualScreen,
  PhrasesScreen,
  StudyScreen,
  PracticeScreen,
  PlannerScreen,
  RubricScreen,
  CompassScreen,
  MapsScreen,
  AtlasHubScreen,
  MyModelsScreen,
  ModelTestScreen,
  DailyBriefScreen,
  ProjectChatsScreen,
  KnowledgeBaseScreen,
  ProjectDocumentScreen,
  DocumentPreviewScreen,
  DownloadManagerScreen,
  ModelSettingsScreen,
  DeviceInfoScreen,
  StorageSettingsScreen,
  SecuritySettingsScreen,
  AppearanceScreen,
  GalleryScreen,
  RemoteServersScreen,
  AboutScreen,
  ToolsScreen,
} from '../screens';
import { KnowledgeScreen } from '../knowledge/KnowledgeScreen';
import { BackupScreen } from '../screens/BackupScreen';
import { AssistantAccessScreen } from '../screens/AssistantAccessScreen';
import { useLayoutClass } from '../hooks/useLayoutClass';
import {
  RootStackParamList,
  MainTabParamList,
} from './types';
import { WorkspaceScreen } from '../screens/WorkspaceScreen';
import { QuickHomeScreen } from '../screens/HomeScreen/QuickHome';
import { PresentationScreen } from '../screens/PresentationScreen';
import { useRegisteredScreens } from './screenRegistry';
import { NAV_ITEMS, TAB_LONG_PRESS, resolveNavBar, type NavItemId } from '../utils/navBar';
import { openAppLink } from './appLinks';
import { RecorderScreen } from '../atlasRecorder/RecorderScreen';
import { RecordingDetailScreen } from '../atlasRecorder/RecordingDetailScreen';
import { LanguageScreen } from '../language/LanguageScreen';
import { LessonScreen } from '../language/LessonScreen';
import { ListeningScreen } from '../language/ListeningScreen';
import { CallScreen } from '../language/CallScreen';
import { CrosswordScreen } from '../language/CrosswordScreen';
import { SearchScreen } from '../search/SearchScreen';
import { SkillsScreen } from '../skills/SkillsScreen';
import { ScheduleScreen } from '../schedule/ScheduleScreen';
import { PinsScreen } from '../pins/PinsScreen';
import { TopicsScreen, TopicBoardScreen, TopicSquareScreen } from '../topics/TopicScreens';
import { ShareScreen } from '../share/ShareScreen';
import { WordSearchScreen } from '../language/WordSearchScreen';
import { WordBookScreen } from '../language/WordBookScreen';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

// Animated tab icon with scale spring on focus. Icons come from the bottom-bar registry.
const TAB_ICON_MAP: Record<string, string> = Object.fromEntries(NAV_ITEMS.map((i) => [i.route, i.icon]));

const TabBarIcon: React.FC<{ name: string; focused: boolean }> = ({ name, focused }) => {
  const { colors, isDark } = useTheme();
  const multi = useAppStore((st) => st.settings.appearance?.accent === 'multi' || st.settings.appearance?.layoutMode === 'colorful');
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
      <Animated.View style={[animatedStyle, multi && !focused && tabStyles.dimmed]}>
        <Icon
          name={TAB_ICON_MAP[name] || 'circle'}
          size={22}
          color={multi ? (sectionColor(name, isDark) ?? colors.primary) : focused ? colors.primary : colors.textMuted}
        />
      </Animated.View>
      {focused && <View style={tabStyles.focusDot} />}
    </View>
  );
};

const createTabBarStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  dimmed: { opacity: 0.55 },
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

const AdaptiveHomeScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const mode = useAppStore(s => s.settings.appearance?.layoutMode ?? 'standard');
  if (mode === 'standard') return <HomeScreen navigation={navigation} />;
  return <QuickHomeScreen navigation={navigation} mode={mode} />;
};

// Shortcut tabs open a full-screen destination; their own page is never shown.
const EmptyTabPage: React.FC = () => null;

const TAB_PAGES: Partial<Record<NavItemId, React.ComponentType<any>>> = {
  home: AdaptiveHomeScreen, chats: ChatsListScreen, workspace: WorkspaceScreen, models: ModelsScreen, settings: SettingsScreen,
  // The briefing is a page of its own on the bar, like Chats, not a screen laid over the app.
  brief: DailyBriefScreen,
};
const TAB_TEST_IDS: Record<string, string> = {
  HomeTab: 'home-tab', ChatsTab: 'chats-tab', ProjectsTab: 'projects-tab', ModelsTab: 'models-tab', SettingsTab: 'settings-tab',
};

// Main Tab Navigator
const MainTabs: React.FC = () => {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const navBar = useAppStore((s) => s.settings?.navBar);
  const appearance = useAppStore((s) => s.settings?.appearance);
  const { order, visible, labels } = useMemo(() => resolveNavBar(navBar), [navBar]);
  const bottomInset = Math.max(insets.bottom, 20);
  const density = appearance?.density ?? (appearance?.layoutMode === 'compact' ? 'compact' : appearance?.layoutMode === 'simple' ? 'spacious' : 'comfortable');
  const bar = density === 'compact' ? (labels ? 48 : 43) : density === 'spacious' ? (labels ? 70 : 57) : (labels ? 60 : 48);
  const tabBarHeight = bar + bottomInset;
  // Tablets, unfolded foldables and landscape phones get a side rail; compact phones keep the bar.
  const { navigationRail } = useLayoutClass();
  const barStyle = navigationRail
    ? {
      backgroundColor: colors.surface,
      borderRightColor: colors.border,
      borderRightWidth: 1,
      borderTopWidth: 0,
      paddingTop: insets.top + 12,
      paddingBottom: insets.bottom,
      paddingLeft: insets.left,
      minWidth: 88 + insets.left,
    }
    : {
      backgroundColor: colors.surface,
      borderTopColor: colors.border,
      borderTopWidth: 1,
      height: tabBarHeight,
      paddingBottom: bottomInset,
      paddingTop: density === 'compact' ? 4 : density === 'spacious' ? 13 : 10,
      ...shadows.medium,
    };

  return (
    <View style={mainTabsStyles.container}>
      <Tab.Navigator
        // Start on the first shown tab that is a real page (a shortcut has no page of its own).
        initialRouteName={(NAV_ITEMS.find((i) => visible.includes(i.id) && TAB_PAGES[i.id]) ?? NAV_ITEMS[0]).route as keyof MainTabParamList}
        backBehavior="history"
        screenOptions={({ route }) => ({
          headerShown: false,
          animation: 'fade',
          lazy: true,
          tabBarShowLabel: labels,
          tabBarPosition: navigationRail ? 'left' : 'bottom',
          tabBarVariant: navigationRail ? 'material' : 'uikit',
          tabBarStyle: barStyle,
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
        {/* Every destination stays a registered route so navigate('ModelsTab') works when it is off the bar. */}
        {order.map((id) => {
          const item = NAV_ITEMS.find((i) => i.id === id)!;
          const shown = visible.includes(id);
          return (
            <Tab.Screen
              key={item.route}
              name={item.route as keyof MainTabParamList}
              component={TAB_PAGES[id] ?? EmptyTabPage}
              options={{
                tabBarLabel: item.label,
                tabBarButtonTestID: TAB_TEST_IDS[item.route] ?? `${id}-tab`,
                ...(shown ? {} : { tabBarButton: () => null, tabBarItemStyle: { display: 'none' as const } }),
              }}
              listeners={({ navigation }) => ({
                // Hold a tab for the thing you most often want from it (New chat, Practice call, Search...).
                tabLongPress: () => {
                  const hold = TAB_LONG_PRESS[id];
                  if (!hold) return;
                  triggerHaptic('impactMedium');
                  if (hold.link) openAppLink(hold.link);
                  else if (hold.screen) (navigation.getParent() as any)?.navigate(hold.screen);
                },
                tabPress: (e: { preventDefault: () => void }) => {
                  triggerHaptic('selection');
                  if (item.target) {
                    e.preventDefault();
                    (navigation.getParent() as any)?.navigate(item.target);
                  }
                },
              })}
            />
          );
        })}
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
  // Reactive: screens registered at runtime 
  // mount as real routes live, without an app restart.
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
        <RootStack.Screen
          name="AgentEdit"
          component={AgentEditScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <RootStack.Screen name="Learning" component={LearningScreen} />
        <RootStack.Screen name="Knowledge" component={KnowledgeScreen} />
        <RootStack.Screen name="Emergency" component={EmergencyScreen} />
        <RootStack.Screen name="OfflineLibrary" component={OfflineLibraryScreen} />
        <RootStack.Screen name="SurvivalManual" component={SurvivalManualScreen} />
        <RootStack.Screen name="Phrases" component={PhrasesScreen} />
        <RootStack.Screen name="Study" component={StudyScreen} />
        <RootStack.Screen name="Practice" component={PracticeScreen} />
        <RootStack.Screen name="Planner" component={PlannerScreen} />
        <RootStack.Screen name="Rubric" component={RubricScreen} />
        <RootStack.Screen name="Compass" component={CompassScreen} />
        <RootStack.Screen name="Maps" component={MapsScreen} />
        <RootStack.Screen name="AtlasHub" component={AtlasHubScreen} />
        <RootStack.Screen name="MyModels" component={MyModelsScreen} />
        <RootStack.Screen name="ModelTest" component={ModelTestScreen} />
        <RootStack.Screen name="DailyBrief" component={DailyBriefScreen} />
        <RootStack.Screen name="KnowledgeBase" component={KnowledgeBaseScreen} />
        <RootStack.Screen name="ProjectDocument" component={ProjectDocumentScreen} />
        <RootStack.Screen name="Recorder" component={RecorderScreen} />
        <RootStack.Screen name="RecordingDetail" component={RecordingDetailScreen} />
        <RootStack.Screen name="Language" component={LanguageScreen} />
        <RootStack.Screen name="Lesson" component={LessonScreen} />
        <RootStack.Screen name="Listening" component={ListeningScreen} />
        <RootStack.Screen name="Call" component={CallScreen} />
        <RootStack.Screen name="Crossword" component={CrosswordScreen} />
        <RootStack.Screen name="Search" component={SearchScreen} />
        <RootStack.Screen name="Skills" component={SkillsScreen} />
        <RootStack.Screen name="Schedule" component={ScheduleScreen} />
        <RootStack.Screen name="Pins" component={PinsScreen} />
        <RootStack.Screen name="Topics" component={TopicsScreen} />
        <RootStack.Screen name="TopicBoard" component={TopicBoardScreen} />
        <RootStack.Screen name="TopicSquare" component={TopicSquareScreen} />
        <RootStack.Screen name="Share" component={ShareScreen} />
        <RootStack.Screen name="WordSearch" component={WordSearchScreen} />
        <RootStack.Screen name="WordBook" component={WordBookScreen} />
        <RootStack.Screen name="DocumentPreview" component={DocumentPreviewScreen} />
        <RootStack.Screen name="ModelSettings" component={ModelSettingsScreen} />
        <RootStack.Screen name="RemoteServers" component={RemoteServersScreen} />
        <RootStack.Screen name="DeviceInfo" component={DeviceInfoScreen} />
        <RootStack.Screen name="StorageSettings" component={StorageSettingsScreen} />
        <RootStack.Screen name="SecuritySettings" component={SecuritySettingsScreen} />
        <RootStack.Screen name="Appearance" component={AppearanceScreen} />
        <RootStack.Screen name="Backup" component={BackupScreen} options={{ headerShown: false }} />
        <RootStack.Screen name="AssistantAccess" component={AssistantAccessScreen} options={{ headerShown: false }} />
        <RootStack.Screen name="Presentations" component={PresentationScreen} />
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
