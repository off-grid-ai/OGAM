/**
 * Integration (RNTL): McpServerModal.
 *
 * Drives the REAL add/edit server sheet against the REAL mcp store + REAL OAuth
 * adapter registry (isOAuthAvailable) to verify:
 *   - add vs edit title/button ("Add MCP server from URL" / "Add" vs "Edit server" / "Save")
 *   - required-field validation blocks save (URL/name), invalid URL rejected, and a
 *     valid add writes a correctly-shaped server to the store + reports its id
 *   - editing an existing server updates the store row in place
 *   - the Authorization dropdown opens, lists options, and selecting "Request header"
 *     reveals the header fields (and blocks save until both are filled)
 *   - OAuth appears only when adapters are configured (capability-as-data), and
 *     selecting it reveals the OAuth explainer + optional client id/secret, which
 *     persist to the store on save
 *   - Cancel / close dispatch onClose and never touch the store
 *
 * Lives in the private pro/ submodule, loaded via a computed path so the suite
 * skips in open-core CI where pro/ is absent.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => <Text {...props}>{name}</Text>;
});

jest.mock('../../../src/theme', () => {
  const colors = {
    text: '#000', textMuted: '#999', textSecondary: '#666', textDisabled: '#bbb',
    primary: '#1DB954', background: '#FFF', surface: '#F5F5F5', surfaceLight: '#EEE',
    border: '#E0E0E0', overlay: 'rgba(0,0,0,0.4)', error: '#FF3B30',
  };
  return { useTheme: () => ({ colors, shadows: { small: {} } }) };
});

type ModalModule = typeof import('../../../pro/ui/McpServerModal');
type StoreModule = typeof import('../../../pro/mcp/mcpStore');
type OAuthModule = typeof import('../../../pro/mcp/oauth');

function load(): {
  modal: ModalModule; store: StoreModule; oauth: OAuthModule;
} | null {
  try {
    return {
      modal: require(['..', '..', '..', 'pro', 'ui', 'McpServerModal'].join('/')),
      store: require(['..', '..', '..', 'pro', 'mcp', 'mcpStore'].join('/')),
      oauth: require(['..', '..', '..', 'pro', 'mcp', 'oauth'].join('/')),
    };
  } catch {
    return null;
  }
}

const mods = load();
const maybe = mods ? describe : describe.skip;

maybe('McpServerModal', () => {
  const { McpServerModal } = mods!.modal;
  const { useMcpStore } = mods!.store;
  const { configureOAuthAdapters, _resetOAuthAdaptersForTesting } = mods!.oauth;

  type ServerConfig = ReturnType<typeof useMcpStore.getState>['servers'][number];

  const resetStore = () =>
    useMcpStore.setState({
      servers: [], connectionStates: {}, serverTools: {}, toolOwners: {}, enabledTools: [],
      knownToolNames: [],
    });

  const enableOAuth = () =>
    configureOAuthAdapters({ redirectUri: 'offgrid://oauth/callback' });

  beforeEach(() => {
    jest.clearAllMocks();
    resetStore();
    _resetOAuthAdaptersForTesting();
  });

  afterEach(() => {
    resetStore();
    _resetOAuthAdaptersForTesting();
  });

  const baseProps = () => ({
    onClose: jest.fn(),
    onSaved: jest.fn(),
  });

  it('shows the add title + "Add" button when there is no existing server', () => {
    const props = baseProps();
    const { getByText } = render(<McpServerModal {...props} />);
    expect(getByText('Add MCP server from URL')).toBeTruthy();
    expect(getByText('Add')).toBeTruthy();
  });

  it('shows the edit title + "Save" button and prefills fields when editing', () => {
    const existing: ServerConfig = {
      id: 'srv-1', name: 'Slack', url: 'https://slack.example.com/mcp', authMode: 'none',
    };
    const props = baseProps();
    const { getByText, getByDisplayValue } = render(
      <McpServerModal {...props} existing={existing} />,
    );
    expect(getByText('Edit server')).toBeTruthy();
    expect(getByText('Save')).toBeTruthy();
    expect(getByDisplayValue('Slack')).toBeTruthy();
    expect(getByDisplayValue('https://slack.example.com/mcp')).toBeTruthy();
  });

  it('blocks save and shows required errors when name + URL are empty', () => {
    const props = baseProps();
    const { getByText, getAllByText } = render(<McpServerModal {...props} />);

    fireEvent.press(getByText('Add'));

    expect(getByText('Name is required.')).toBeTruthy();
    expect(getByText('URL is required.')).toBeTruthy();
    // getAllByText proves both inline errors rendered; nothing was written / reported.
    expect(getAllByText('alert-circle').length).toBeGreaterThanOrEqual(2);
    expect(useMcpStore.getState().servers).toHaveLength(0);
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it('rejects an invalid URL and does not add a server', () => {
    const props = baseProps();
    const { getByText, getByPlaceholderText } = render(<McpServerModal {...props} />);

    fireEvent.changeText(getByPlaceholderText('e.g. Slack'), 'My Server');
    fireEvent.changeText(getByPlaceholderText('https://api.example.com/mcp'), 'not a url');
    fireEvent.press(getByText('Add'));

    expect(getByText('Enter a valid URL (e.g. https://api.example.com/mcp).')).toBeTruthy();
    expect(useMcpStore.getState().servers).toHaveLength(0);
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it('adds a correctly-shaped "none"-auth server and reports its id', () => {
    const props = baseProps();
    const { getByText, getByPlaceholderText } = render(<McpServerModal {...props} />);

    fireEvent.changeText(getByPlaceholderText('e.g. Slack'), '  My Server  ');
    fireEvent.changeText(getByPlaceholderText('https://api.example.com/mcp'), '  https://api.example.com/mcp  ');
    fireEvent.press(getByText('Add'));

    const servers = useMcpStore.getState().servers;
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({
      name: 'My Server',
      url: 'https://api.example.com/mcp',
      authMode: 'none',
    });
    expect(servers[0].authHeaderName).toBeUndefined();
    expect(props.onSaved).toHaveBeenCalledWith(servers[0].id);
  });

  it('updates an existing server in place on save (edit path)', () => {
    const existing: ServerConfig = {
      id: 'srv-1', name: 'Old', url: 'https://old.example.com/mcp', authMode: 'none',
    };
    useMcpStore.setState({ servers: [existing] });
    const props = baseProps();
    const { getByText, getByDisplayValue } = render(
      <McpServerModal {...props} existing={existing} />,
    );

    fireEvent.changeText(getByDisplayValue('Old'), 'New Name');
    fireEvent.press(getByText('Save'));

    const servers = useMcpStore.getState().servers;
    expect(servers).toHaveLength(1);
    expect(servers[0].id).toBe('srv-1');
    expect(servers[0].name).toBe('New Name');
    expect(props.onSaved).toHaveBeenCalledWith('srv-1');
  });

  it('does not list OAuth in the dropdown when adapters are unconfigured', () => {
    const props = baseProps();
    const { getByText, queryByText } = render(<McpServerModal {...props} />);

    // Open the dropdown (trigger shows the current selection, "None").
    fireEvent.press(getByText('None'));

    expect(getByText('Request header')).toBeTruthy();
    expect(queryByText('OAuth')).toBeNull();
  });

  it('reveals header fields when "Request header" is selected and blocks save until filled', () => {
    const props = baseProps();
    const { getByText, getByPlaceholderText, queryByPlaceholderText } = render(
      <McpServerModal {...props} />,
    );

    expect(queryByPlaceholderText('Authorization')).toBeNull();

    fireEvent.press(getByText('None'));
    fireEvent.press(getByText('Request header'));

    // Header fields now shown.
    expect(getByPlaceholderText('Authorization')).toBeTruthy();
    expect(getByPlaceholderText('Bearer your-token-here')).toBeTruthy();

    // Fill name + url but leave headers empty -> save blocked with header error.
    fireEvent.changeText(getByPlaceholderText('e.g. Slack'), 'Hdr Server');
    fireEvent.changeText(getByPlaceholderText('https://api.example.com/mcp'), 'https://h.example.com/mcp');
    fireEvent.press(getByText('Add'));

    expect(getByText('Both header name and value are required.')).toBeTruthy();
    expect(useMcpStore.getState().servers).toHaveLength(0);
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it('adds a header-auth server with the header name/value once both are provided', () => {
    const props = baseProps();
    const { getByText, getByPlaceholderText } = render(<McpServerModal {...props} />);

    fireEvent.press(getByText('None'));
    fireEvent.press(getByText('Request header'));

    fireEvent.changeText(getByPlaceholderText('e.g. Slack'), 'Hdr Server');
    fireEvent.changeText(getByPlaceholderText('https://api.example.com/mcp'), 'https://h.example.com/mcp');
    fireEvent.changeText(getByPlaceholderText('Authorization'), 'X-Api-Key');
    fireEvent.changeText(getByPlaceholderText('Bearer your-token-here'), 'secret-token');
    fireEvent.press(getByText('Add'));

    const servers = useMcpStore.getState().servers;
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({
      name: 'Hdr Server',
      authMode: 'header',
      authHeaderName: 'X-Api-Key',
      authHeaderValue: 'secret-token',
    });
    expect(props.onSaved).toHaveBeenCalledWith(servers[0].id);
  });

  it('lists OAuth and, when selected, shows the explainer + optional client fields that persist', () => {
    enableOAuth();
    const props = baseProps();
    const { getByText, getByPlaceholderText } = render(<McpServerModal {...props} />);

    fireEvent.press(getByText('None'));
    expect(getByText('OAuth')).toBeTruthy();
    fireEvent.press(getByText('OAuth'));

    // Explainer + optional client fields revealed.
    expect(getByText(/A browser opens to sign in/)).toBeTruthy();
    const clientId = getByPlaceholderText('Only for GitHub, Google, etc.');
    const clientSecret = getByPlaceholderText('If the provider issued one');

    fireEvent.changeText(getByPlaceholderText('e.g. Slack'), 'GitHub');
    fireEvent.changeText(getByPlaceholderText('https://api.example.com/mcp'), 'https://api.github.com/mcp');
    fireEvent.changeText(clientId, '  client-123  ');
    fireEvent.changeText(clientSecret, '  shh  ');
    fireEvent.press(getByText('Add'));

    const servers = useMcpStore.getState().servers;
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({
      name: 'GitHub',
      authMode: 'oauth',
      oauthClientId: 'client-123',
      oauthClientSecret: 'shh',
    });
    expect(props.onSaved).toHaveBeenCalledWith(servers[0].id);
  });

  it('validates name + URL on blur (empty -> error shown)', () => {
    const props = baseProps();
    const { getByPlaceholderText, getByText, queryByText } = render(
      <McpServerModal {...props} />,
    );

    expect(queryByText('Name is required.')).toBeNull();

    fireEvent(getByPlaceholderText('e.g. Slack'), 'blur');
    fireEvent(getByPlaceholderText('https://api.example.com/mcp'), 'blur');

    expect(getByText('Name is required.')).toBeTruthy();
    expect(getByText('URL is required.')).toBeTruthy();
  });

  it('clears a showing name/URL error live as the user types a valid value', () => {
    const props = baseProps();
    const { getByPlaceholderText, getByText, queryByText } = render(
      <McpServerModal {...props} />,
    );

    // Surface both errors first.
    fireEvent.press(getByText('Add'));
    expect(getByText('Name is required.')).toBeTruthy();
    expect(getByText('URL is required.')).toBeTruthy();

    // Typing re-validates because the error is currently shown -> error clears.
    fireEvent.changeText(getByPlaceholderText('e.g. Slack'), 'Now Named');
    fireEvent.changeText(getByPlaceholderText('https://api.example.com/mcp'), 'https://ok.example.com/mcp');

    expect(queryByText('Name is required.')).toBeNull();
    expect(queryByText('URL is required.')).toBeNull();
  });

  it('derives the name-field placeholder from the typed URL host', () => {
    const props = baseProps();
    const { getByPlaceholderText, queryByPlaceholderText } = render(
      <McpServerModal {...props} />,
    );

    // Before a URL, the name placeholder is the fallback example.
    expect(getByPlaceholderText('e.g. Slack')).toBeTruthy();

    fireEvent.changeText(
      getByPlaceholderText('https://api.example.com/mcp'),
      'https://api.notion.com/mcp',
    );

    // Placeholder now derives from the host: api. prefix stripped, capitalized.
    expect(getByPlaceholderText('Notion')).toBeTruthy();
    expect(queryByPlaceholderText('e.g. Slack')).toBeNull();
  });

  it('re-validates header fields live while an error is showing, then saves once both are filled', () => {
    const props = baseProps();
    const { getByText, getByPlaceholderText } = render(<McpServerModal {...props} />);

    fireEvent.press(getByText('None'));
    fireEvent.press(getByText('Request header'));
    fireEvent.changeText(getByPlaceholderText('e.g. Slack'), 'Hdr');
    fireEvent.changeText(getByPlaceholderText('https://api.example.com/mcp'), 'https://h.example.com/mcp');

    // Trigger the header error, then type both header values (drives the live
    // re-validation branch in each header field's onChangeText).
    fireEvent.press(getByText('Add'));
    expect(getByText('Both header name and value are required.')).toBeTruthy();
    fireEvent.changeText(getByPlaceholderText('Authorization'), 'X-Api-Key');
    fireEvent.changeText(getByPlaceholderText('Bearer your-token-here'), 'tok');

    // Pressing Add now passes validation and writes the header-auth server.
    fireEvent.press(getByText('Add'));
    const servers = useMcpStore.getState().servers;
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({
      authMode: 'header', authHeaderName: 'X-Api-Key', authHeaderValue: 'tok',
    });
  });

  it('keeps cached OAuth metadata when editing an OAuth server without changing the client id', () => {
    enableOAuth();
    const cachedOAuth = { issuer: 'https://gh.example.com' } as unknown as ServerConfig['oauth'];
    const existing: ServerConfig = {
      id: 'srv-oauth', name: 'GitHub', url: 'https://api.github.com/mcp',
      authMode: 'oauth', oauthClientId: 'client-abc', oauth: cachedOAuth,
    };
    useMcpStore.setState({ servers: [existing] });
    const props = baseProps();
    const { getByText, getByDisplayValue } = render(
      <McpServerModal {...props} existing={existing} />,
    );

    // Rename only; leave OAuth + the same client id -> cached oauth is preserved.
    fireEvent.changeText(getByDisplayValue('GitHub'), 'GitHub Prod');
    fireEvent.press(getByText('Save'));

    const saved = useMcpStore.getState().servers[0];
    expect(saved.name).toBe('GitHub Prod');
    expect(saved.authMode).toBe('oauth');
    expect(saved.oauthClientId).toBe('client-abc');
    expect(saved.oauth).toBe(cachedOAuth);
  });

  it('drops cached OAuth metadata when the client id changes on edit', () => {
    enableOAuth();
    const cachedOAuth = { issuer: 'https://gh.example.com' } as unknown as ServerConfig['oauth'];
    const existing: ServerConfig = {
      id: 'srv-oauth', name: 'GitHub', url: 'https://api.github.com/mcp',
      authMode: 'oauth', oauthClientId: 'client-abc', oauth: cachedOAuth,
    };
    useMcpStore.setState({ servers: [existing] });
    const props = baseProps();
    const { getByText, getByDisplayValue } = render(
      <McpServerModal {...props} existing={existing} />,
    );

    // Change the client id -> the stale cached registration/token metadata is dropped.
    fireEvent.changeText(getByDisplayValue('client-abc'), 'client-xyz');
    fireEvent.press(getByText('Save'));

    const saved = useMcpStore.getState().servers[0];
    expect(saved.oauthClientId).toBe('client-xyz');
    expect(saved.oauth).toBeUndefined();
  });

  it('calls onClose from the Cancel button without writing to the store', () => {
    const props = baseProps();
    const { getByText } = render(<McpServerModal {...props} />);

    fireEvent.press(getByText('Cancel'));

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(useMcpStore.getState().servers).toHaveLength(0);
    expect(props.onSaved).not.toHaveBeenCalled();
  });
});
