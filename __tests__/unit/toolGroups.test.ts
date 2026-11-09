import { applyProjectScope, withGroup, groupIsOn, TOOL_GROUPS, PROJECT_TOOL_IDS, toolsForConversation } from '../../src/services/tools/chatTools';
import { AVAILABLE_TOOLS } from '../../src/services/tools';

describe('tool permission groups', () => {
  it('only name tools that exist', () => {
    const ids = AVAILABLE_TOOLS.map((t) => t.id);
    for (const g of TOOL_GROUPS) for (const t of g.tools) expect(ids).toContain(t);
    for (const t of PROJECT_TOOL_IDS) expect(ids).toContain(t);
  });
  it('turn a whole group on and off without touching other tools', () => {
    const files = TOOL_GROUPS.find((g) => g.id === 'files')!.tools;
    const on = withGroup(['web_search'], files, true);
    expect(groupIsOn(files, on)).toBe(true);
    expect(on).toContain('web_search');
    expect(withGroup(on, files, false)).toEqual(['web_search']);
  });
  it('keeps study, maths and project-document tools out of regular chats', () => {
    const all = ['web_search', 'study_math', 'science_data', 'study_helpers', 'update_project_document', 'search_knowledge_base'];
    expect(applyProjectScope(all, false)).toEqual(['web_search']);
  });
  it('gives project chats those tools without anything to switch on', () => {
    const got = applyProjectScope(['web_search'], true);
    for (const t of PROJECT_TOOL_IDS) expect(got).toContain(t);
    expect(new Set(got).size).toBe(got.length);
  });
  it('applies to the tools a turn is sent with', () => {
    const tools = ['web_search', 'study_math'];
    expect(toolsForConversation({ enabledTools: tools })).toEqual(['web_search']);
    expect(toolsForConversation({ enabledTools: tools, projectId: 'p1' })).toContain('study_math');
  });
});
