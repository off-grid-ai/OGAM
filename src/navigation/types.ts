import { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Onboarding: undefined;
  AutoSetup: undefined;
  AdvancedSetup: undefined;
  AnalyticsInfo: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  // Former ChatsStack
  Chat: { conversationId?: string; projectId?: string };
  // Former ProjectsStack
  ProjectDetail: { projectId: string };
  ProjectEdit: { projectId?: string };
  ProjectChats: { projectId: string };
  KnowledgeBase: { projectId: string };
  DocumentPreview: {
    filePath: string;
    fileName: string;
    fileSize: number;
    /** An attached document's index: show its stored pages, opened at `page`. */
    documentId?: string;
    page?: number;
  };
  // Former SettingsStack
  ModelSettings: undefined;
  RemoteServers: undefined;
  /** `needsKey`: the scan found Off Grid AI Desktop, and it asks for an API key. */
  RemoteServerEditor: { serverId?: string; needsKey?: boolean } | undefined;
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
};

// Tab navigator — simple, no sub-stacks
export type MainTabParamList = {
  HomeTab: undefined;
  ChatsTab: undefined;
  ProjectsTab: undefined;
  ModelsTab:
    | {
        initialTab?: 'text' | 'image' | 'video' | 'voice' | 'transcription' | 'embedding';
        repairModelId?: string;
        initialSearchQuery?: string;
      }
    | undefined;
  SettingsTab: undefined;
};
