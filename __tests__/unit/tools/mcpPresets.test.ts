/**
 * Unit: MCP quick-setup presets.
 *
 * Covers the pure helpers behind the add-server quick-setup list:
 *   - filterMcpPresets (the search box)
 *   - presetToServerConfig (preset -> McpServerConfig)
 *   - data invariants (valid urls/auth modes, brand-voice copy)
 *
 * Lives in the private pro/ submodule, loaded via a computed path so the suite
 * skips in open-core CI where pro/ is absent.
 */

type PresetModule = typeof import('../../../pro/ui/mcpPresets');

function loadPresets(): PresetModule | null {
  const proPath = ['..', '..', '..', 'pro', 'ui', 'mcpPresets'].join('/');
  try {
    return require(proPath) as PresetModule;
  } catch {
    return null;
  }
}

const mod = loadPresets();
const maybe = mod ? describe : describe.skip;

maybe('MCP presets', () => {
  const { MCP_PRESETS, filterMcpPresets, presetToServerConfig, presetIdForServer } = mod!;

  describe('filterMcpPresets', () => {
    it('returns all presets for an empty or whitespace query', () => {
      expect(filterMcpPresets(MCP_PRESETS, '')).toHaveLength(MCP_PRESETS.length);
      expect(filterMcpPresets(MCP_PRESETS, '   ')).toHaveLength(MCP_PRESETS.length);
    });

    it('matches on name, case-insensitively and trimmed', () => {
      const res = filterMcpPresets(MCP_PRESETS, '  NoTiOn ');
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe('notion');
    });

    it('matches on description text', () => {
      // "Work with Jira issues and Confluence pages." -> Atlassian
      const res = filterMcpPresets(MCP_PRESETS, 'jira');
      expect(res.map(p => p.id)).toContain('atlassian');
    });

    it('returns an empty array when nothing matches', () => {
      expect(filterMcpPresets(MCP_PRESETS, 'zzzznomatch')).toEqual([]);
    });
  });

  describe('presetToServerConfig', () => {
    it('maps preset fields and builds a unique, suffixed id', () => {
      const preset = MCP_PRESETS.find(p => p.id === 'notion')!;
      const cfg = presetToServerConfig(preset, '12345');
      expect(cfg).toEqual({
        id: 'mcp-notion-12345',
        name: 'Notion',
        url: preset.url,
        authMode: preset.authMode,
      });
    });

    it('produces different ids for different suffixes so a preset can be re-added', () => {
      const preset = MCP_PRESETS[0];
      expect(presetToServerConfig(preset, 'a').id).not.toBe(
        presetToServerConfig(preset, 'b').id,
      );
    });
  });

  describe('presetIdForServer', () => {
    it('resolves the preset id from a configured server url', () => {
      const preset = MCP_PRESETS.find(p => p.id === 'notion')!;
      expect(presetIdForServer({ id: 'whatever', url: preset.url })).toBe('notion');
    });

    it('falls back to the id prefix when the url does not match', () => {
      expect(presetIdForServer({ id: 'mcp-linear-999', url: 'https://moved.example/sse' })).toBe('linear');
    });

    it('returns undefined for a custom (bring-your-own) server', () => {
      expect(presetIdForServer({ id: 'custom-1', url: 'https://my.server/mcp' })).toBeUndefined();
    });
  });

  describe('data invariants', () => {
    it('includes the agreed first-batch servers and excludes fetch', () => {
      const ids = MCP_PRESETS.map(p => p.id);
      expect(ids).toEqual(
        expect.arrayContaining(['notion', 'linear', 'atlassian', 'hugging_face', 'deepwiki']),
      );
      expect(ids).not.toContain('fetch');
      expect(ids).not.toContain('asana');
    });

    it('every preset has an https url and a valid auth mode', () => {
      for (const p of MCP_PRESETS) {
        expect(p.url.startsWith('https://')).toBe(true);
        expect(['none', 'header', 'oauth']).toContain(p.authMode);
      }
    });

    it('descriptions follow the brand voice (no exclamation marks, em dashes or curly quotes)', () => {
      for (const p of MCP_PRESETS) {
        expect(p.name.length).toBeGreaterThan(0);
        expect(p.description.length).toBeGreaterThan(0);
        expect(p.description).not.toMatch(/[!—‘’“”]/);
      }
    });
  });
});
