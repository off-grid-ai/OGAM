import { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Onboarding: undefined;
  OnboardingGroups: undefined;
  OnboardingFeatures: undefined;
  OnboardingGuide: undefined;
  WhatYouUse: undefined;
  AutoSetup: undefined;
  AdvancedSetup: undefined;
  AnalyticsInfo: undefined;
  Language: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  // Former ChatsStack
  /** `mode` opens a new chat already making pictures or clips (a pick from onboarding, Video Studio). */
  Chat: { conversationId?: string; projectId?: string; mode?: ChatStartMode };
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
  SearchModel: undefined;
  SecuritySettings: undefined;
  EngineUpdates: undefined;
  Sync: undefined;
  Notifications: undefined;
  // Already in RootStack
  DownloadManager: undefined;
  Gallery: { conversationId?: string } | undefined;
  GalleryImage: { imageId: string };
  GalleryVideo: { videoId: string };
  /** unlock: open the license-key field on arrival (the checkout sheet's way back). */
  ProDetail: { unlock?: boolean; offline?: boolean } | undefined;
  /** "What it does for you", from the info button on Home. */
  /** `ask`: a question to ask as the guide opens (a feature's "Ask more"); `at` makes each one new. */
  Guide: { ask?: string; at?: number } | undefined;
  GuideTopic: { id: string };
  About: undefined;
  Tools: undefined;
  WebSearchSettings: undefined;
};

/** What a new chat starts making: pictures or clips. */
type ChatStartMode = 'image' | 'video';

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
  ProTab: undefined;
  SettingsTab: undefined;
};
