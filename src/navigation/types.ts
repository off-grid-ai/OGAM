import { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Onboarding: undefined;
  ModelDownload: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  // Former ChatsStack
  Chat: { conversationId?: string; projectId?: string; privateChat?: boolean; /** Text typed in the message box when the chat opens (a quick start). */ starter?: string };
  // Former ProjectsStack
  ProjectDetail: { projectId: string };
  ProjectEdit: { projectId?: string };
  AgentEdit: { agentId?: string };
  Learning: { agentId?: string } | undefined;
  Knowledge: undefined;
  Emergency: undefined;
  OfflineLibrary: undefined;
  SurvivalManual: { chapterId?: string } | undefined;
  Phrases: undefined;
  Study: { projectId: string; openAt?: number };
  Practice: { projectId: string };
  Planner: undefined;
  DailyBrief: undefined;
  Compass: undefined;
  Maps: undefined;
  AtlasHub: undefined;
  MyModels: undefined;
  ModelTest: { modelId: string };
  ProjectChats: { projectId: string };
  KnowledgeBase: { projectId: string };
  ProjectDocument: { projectId: string; docId?: number; name?: string };
  Recorder: undefined;
  Search: undefined;
  Share: { text: string };
  Skills: undefined;
  Schedule: undefined;
  Topics: { projectId?: string; topic?: string } | undefined;
  TopicBoard: { courseId: string };
  TopicSquare: { courseId: string; key: string };
  Language: undefined;
  Lesson: { unitId: string; mode?: 'speed' | 'review' | 'checkpoint' | 'exam'; part?: number; parts?: number; key?: string; level?: number };
  WordSearch: { unitId: string; key?: string };
  Crossword: { unitId: string; key?: string };
  Call: { key?: string; scenarioId?: string } | undefined;
  WordBook: undefined;
  Listening: { kind: 'story' | 'podcast'; at?: number; space?: string; level?: number; index?: number; pieceId?: string };
  RecordingDetail: { id: string };
  DocumentPreview: { filePath: string; fileName: string; fileSize: number };
  // Former SettingsStack
  ModelSettings: undefined;
  RemoteServers: undefined;
  DeviceInfo: undefined;
  StorageSettings: undefined;
  SecuritySettings: undefined;
  Appearance: undefined;
  Presentations: { slides?: import('../services/presentationTemplates').PresentationSlide[]; name?: string } | undefined;
  Pins: undefined;
  // Already in RootStack
  DownloadManager: undefined;
  Gallery: { conversationId?: string } | undefined;
  ProDetail: undefined;
  About: undefined;
  Tools: { conversationId?: string } | undefined;
};

// Tab navigator — simple, no sub-stacks
export type MainTabParamList = {
  HomeTab: undefined;
  ChatsTab: undefined;
  ProjectsTab: undefined;
  ModelsTab: { initialTab?: 'text' | 'image' | 'voice' | 'transcription'; repairModelId?: string; initialSearchQuery?: string } | undefined;
  SettingsTab: undefined;
  // Optional bottom-bar shortcuts: each opens a full-screen destination.
  EmergencyTab: undefined;
  LibraryTab: undefined;
  BriefTab: undefined;
  RecorderTab: undefined;
  LanguageTab: undefined;
  CompassTab: undefined;
  PhrasesTab: undefined;
  SurvivalTab: undefined;
};
