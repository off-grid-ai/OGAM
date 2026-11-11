import { layoutClassFor, layoutInfoFor } from '../../../src/hooks/useLayoutClass';

describe('layout classes', () => {
  it('keeps phones in portrait compact with the bottom bar', () => {
    const phone = layoutInfoFor(412, 915);
    expect(phone.layoutClass).toBe('compact');
    expect(phone.navigationRail).toBe(false);
    expect(phone.twoPane).toBe(false);
  });

  it('uses the rail but a single pane for a landscape phone, foldable or portrait tablet', () => {
    for (const [w, h] of [[732, 412], [673, 841], [800, 1280]]) {
      const info = layoutInfoFor(w, h);
      expect(info.layoutClass).toBe('medium');
      expect(info.navigationRail).toBe(true);
      expect(info.twoPane).toBe(false);
    }
  });

  it('uses two panes on the 13.2-inch tablet in landscape', () => {
    const tablet = layoutInfoFor(1280, 800);
    expect(tablet.layoutClass).toBe('expanded');
    expect(tablet.navigationRail).toBe(true);
    expect(tablet.twoPane).toBe(true);
  });

  it('switches exactly at the breakpoints', () => {
    expect(layoutClassFor(599)).toBe('compact');
    expect(layoutClassFor(600)).toBe('medium');
    expect(layoutClassFor(839)).toBe('medium');
    expect(layoutClassFor(840)).toBe('expanded');
  });
});
