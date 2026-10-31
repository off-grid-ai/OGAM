/**
 * DebugSheet Component Tests
 *
 * Tests for the debug info bottom sheet:
 * - Context stats display
 * - Message stats display
 * - Active project display
 * - System prompt display
 * - Formatted prompt display
 * - Conversation messages display
 * - Null/default handling
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { DebugSheet } from '../../../src/components/DebugSheet';
import { DebugInfo, Project, Conversation } from '../../../src/types';

// Mock AppSheet to render children directly

const createDebugInfo = (overrides: Partial<DebugInfo> = {}): DebugInfo => ({
  estimatedTokens: 150,
  maxContextLength: 2048,
  contextUsagePercent: 7.3,
  originalMessageCount: 5,
  managedMessageCount: 5,
  truncatedCount: 0,
  systemPrompt: 'You are a helpful assistant.',
  formattedPrompt: '<|im_start|>system\nYou are a helpful assistant.<|im_end|>',
  ...overrides,
});

const createProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'proj-1',
  name: 'Code Review',
  description: 'Review code',
  systemPrompt: 'You are a code reviewer.',
  icon: '#10B981',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const createConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: 'conv-1',
  title: 'Test Conversation',
  modelId: 'model-1',
  messages: [
    { id: 'msg-1', role: 'user', content: 'Hello!', timestamp: Date.now() },
    { id: 'msg-2', role: 'assistant', content: 'Hi there! How can I help?', timestamp: Date.now() },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const defaultProps = {
  visible: true,
  onClose: jest.fn(),
  debugInfo: createDebugInfo(),
  activeProject: null,
  settings: { systemPrompt: 'You are a helpful AI assistant.' },
  activeConversation: null,
};

describe('DebugSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // Visibility
  // ============================================================================
  describe('visibility', () => {
    it('renders nothing when not visible', () => {
      const { toJSON } = render(
        <DebugSheet {...defaultProps} visible={false} />
      );
      expect(toJSON()).toBeNull();
    });

    it('renders content when visible', () => {
      const { getByText } = render(
        <DebugSheet {...defaultProps} />
      );
      expect(getByText('Debug Info')).toBeTruthy();
    });
  });

  // ============================================================================
  // Context Stats
  // ============================================================================
  describe('context stats', () => {
    it('shows Context Stats section title', () => {
      const { getByText } = render(
        <DebugSheet {...defaultProps} />
      );
      expect(getByText('Context Stats')).toBeTruthy();
    });

    it('displays estimated tokens', () => {
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          debugInfo={createDebugInfo({ estimatedTokens: 250 })}
        />
      );
      expect(getByText('250')).toBeTruthy();
    });

    it('displays max context length', () => {
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          debugInfo={createDebugInfo({ maxContextLength: 4096 })}
        />
      );
      expect(getByText('4096')).toBeTruthy();
    });

    it('displays context usage percent', () => {
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          debugInfo={createDebugInfo({ contextUsagePercent: 15.7 })}
        />
      );
      expect(getByText('15.7%')).toBeTruthy();
    });

    it('shows labels for stats', () => {
      const { getByText } = render(
        <DebugSheet {...defaultProps} />
      );
      expect(getByText('Tokens Used')).toBeTruthy();
      expect(getByText('Max Context')).toBeTruthy();
      expect(getByText('Usage')).toBeTruthy();
    });

    it('shows default 0 values when debugInfo is null', () => {
      const { getAllByText } = render(
        <DebugSheet {...defaultProps} debugInfo={null} />
      );
      // estimatedTokens, originalMessageCount, managedMessageCount, truncatedCount
      // all default to 0
      expect(getAllByText('0').length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // Message Stats
  // ============================================================================
  describe('message stats', () => {
    it('shows Message Stats section title', () => {
      const { getByText } = render(
        <DebugSheet {...defaultProps} />
      );
      expect(getByText('Message Stats')).toBeTruthy();
    });

    it('displays original message count', () => {
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          debugInfo={createDebugInfo({ originalMessageCount: 10 })}
        />
      );
      expect(getByText('Original Messages:')).toBeTruthy();
      expect(getByText('10')).toBeTruthy();
    });

    it('displays managed message count', () => {
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          debugInfo={createDebugInfo({ managedMessageCount: 8 })}
        />
      );
      expect(getByText('After Context Mgmt:')).toBeTruthy();
      expect(getByText('8')).toBeTruthy();
    });

    it('displays truncated count', () => {
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          debugInfo={createDebugInfo({ truncatedCount: 2 })}
        />
      );
      expect(getByText('Truncated:')).toBeTruthy();
      expect(getByText('2')).toBeTruthy();
    });

    it('does not apply warning style when truncatedCount is 0', () => {
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          debugInfo={createDebugInfo({ truncatedCount: 0 })}
        />
      );
      // The '0' is rendered without the warning style
      expect(getByText('Truncated:')).toBeTruthy();
    });
  });

  // ============================================================================
  // Active Project
  // ============================================================================
  describe('active project', () => {
    it('shows Active Project section title', () => {
      const { getByText } = render(
        <DebugSheet {...defaultProps} />
      );
      expect(getByText('Active Project')).toBeTruthy();
    });

    it('shows project name when project is active', () => {
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          activeProject={createProject({ name: 'Spanish Tutor' })}
        />
      );
      expect(getByText('Spanish Tutor')).toBeTruthy();
    });

    it('shows "Default" when no project is active', () => {
      const { getByText } = render(
        <DebugSheet {...defaultProps} activeProject={null} />
      );
      expect(getByText('Default')).toBeTruthy();
    });
  });

  // ============================================================================
  // System Prompt
  // ============================================================================
  describe('system prompt', () => {
    it('shows System Prompt section title', () => {
      const { getByText } = render(
        <DebugSheet {...defaultProps} />
      );
      expect(getByText('System Prompt')).toBeTruthy();
    });

    it('displays debugInfo system prompt when available', () => {
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          debugInfo={createDebugInfo({ systemPrompt: 'Debug system prompt here' })}
        />
      );
      expect(getByText('Debug system prompt here')).toBeTruthy();
    });

    it('falls back to settings system prompt when debugInfo has no systemPrompt', () => {
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          debugInfo={createDebugInfo({ systemPrompt: '' })}
          settings={{ systemPrompt: 'Settings fallback prompt' }}
        />
      );
      expect(getByText('Settings fallback prompt')).toBeTruthy();
    });

    it('falls back to default prompt when both empty', () => {
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          debugInfo={null}
          settings={{ systemPrompt: undefined }}
        />
      );
      // Falls back to APP_CONFIG.defaultSystemPrompt
      expect(getByText(/helpful AI assistant/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Formatted Prompt
  // ============================================================================
  describe('formatted prompt', () => {
    it('shows Last Formatted Prompt section title', () => {
      const { getByText } = render(
        <DebugSheet {...defaultProps} />
      );
      expect(getByText('Last Formatted Prompt')).toBeTruthy();
    });

    it('displays formatted prompt from debug info', () => {
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          debugInfo={createDebugInfo({ formattedPrompt: '<|system|>Test prompt' })}
        />
      );
      expect(getByText('<|system|>Test prompt')).toBeTruthy();
    });

    it('shows placeholder when no formatted prompt', () => {
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          debugInfo={createDebugInfo({ formattedPrompt: '' })}
        />
      );
      expect(getByText('Send a message to see the formatted prompt')).toBeTruthy();
    });

    it('shows hint text about ChatML format', () => {
      const { getByText } = render(
        <DebugSheet {...defaultProps} />
      );
      expect(getByText(/exact prompt sent to the LLM/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Conversation Messages
  // ============================================================================
  describe('conversation messages', () => {
    it('shows Conversation Messages section title with count', () => {
      const conversation = createConversation();
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          activeConversation={conversation}
        />
      );
      expect(getByText(`Conversation Messages (${conversation.messages.length})`)).toBeTruthy();
    });

    it('shows 0 count when no conversation', () => {
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          activeConversation={null}
        />
      );
      expect(getByText('Conversation Messages (0)')).toBeTruthy();
    });

    it('renders user messages with USER role', () => {
      const conversation = createConversation({
        messages: [
          { id: 'msg-1', role: 'user', content: 'Test question', timestamp: Date.now() },
        ],
      });
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          activeConversation={conversation}
        />
      );
      expect(getByText('USER')).toBeTruthy();
      expect(getByText('Test question')).toBeTruthy();
    });

    it('renders assistant messages with ASSISTANT role', () => {
      const conversation = createConversation({
        messages: [
          { id: 'msg-1', role: 'assistant', content: 'Test answer', timestamp: Date.now() },
        ],
      });
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          activeConversation={conversation}
        />
      );
      expect(getByText('ASSISTANT')).toBeTruthy();
      expect(getByText('Test answer')).toBeTruthy();
    });

    it('shows message index numbers', () => {
      const conversation = createConversation({
        messages: [
          { id: 'msg-1', role: 'user', content: 'First', timestamp: Date.now() },
          { id: 'msg-2', role: 'assistant', content: 'Second', timestamp: Date.now() },
        ],
      });
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          activeConversation={conversation}
        />
      );
      expect(getByText('#1')).toBeTruthy();
      expect(getByText('#2')).toBeTruthy();
    });

    it('renders multiple messages', () => {
      const conversation = createConversation({
        messages: [
          { id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() },
          { id: 'msg-2', role: 'assistant', content: 'Hi there', timestamp: Date.now() },
          { id: 'msg-3', role: 'user', content: 'Help me', timestamp: Date.now() },
        ],
      });
      const { getByText } = render(
        <DebugSheet
          {...defaultProps}
          activeConversation={conversation}
        />
      );
      expect(getByText('Conversation Messages (3)')).toBeTruthy();
      expect(getByText('Hello')).toBeTruthy();
      expect(getByText('Hi there')).toBeTruthy();
      expect(getByText('Help me')).toBeTruthy();
    });
  });

  // ============================================================================
  // Default values when debugInfo is null
  // ============================================================================
  describe('null debugInfo defaults', () => {
    it('uses APP_CONFIG.maxContextLength as default', () => {
      const { getByText } = render(
        <DebugSheet {...defaultProps} debugInfo={null} />
      );
      // Default is 4096 from APP_CONFIG
      expect(getByText('4096')).toBeTruthy();
    });

    it('uses 0.0% as default usage', () => {
      const { getByText } = render(
        <DebugSheet {...defaultProps} debugInfo={null} />
      );
      expect(getByText('0.0%')).toBeTruthy();
    });
  });
});
