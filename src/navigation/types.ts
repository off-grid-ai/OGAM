import { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Onboarding: undefined;
  AutoSetup: undefined;
  AdvancedSetup: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  // Former ChatsStack
  Chat: { conversationId?: string; projectId?: string };
  // Former ProjectsStack
  ProjectDetail: { projectId: string };
  ProjectEdit: { projectId?: string };
  ProjectChats: { projectId: string };
  KnowledgeBase: { projectId: string };
  DocumentPreview: { filePath: string; fileName: string; fileSize: number };
  // Former SettingsStack
  ModelSettings: undefined;
  RemoteServers: undefined;
  RemoteServerEditor: { serverId?: string } | undefined;
  DeviceInfo: undefined;
  StorageSettings: undefined;
  SecuritySettings: undefined;
  Sync: undefined;
  Notifications: undefined;
  // Already in RootStack
  DownloadManager: undefined;
  Gallery: { conversationId?: string } | undefined;
  ProDetail: undefined;
  About: undefined;
  Tools: undefined;
  Ambient: undefined;
  AmbientTimeline: undefined;
  AmbientSession: { sessionId: string };
};

// Tab navigator — simple, no sub-stacks
export type MainTabParamList = {
  HomeTab: undefined;
  ChatsTab: undefined;
  ProjectsTab: undefined;
  ModelsTab:
    | {
        initialTab?: 'text' | 'image' | 'voice' | 'transcription';
        repairModelId?: string;
        initialSearchQuery?: string;
      }
    | undefined;
  SettingsTab: undefined;
};
