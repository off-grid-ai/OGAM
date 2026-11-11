import { buildFromVersion, buildFromTag, updateFromRelease, checkForUpdate } from '../../src/services/appUpdate';

jest.mock('../../src/utils/appVersion', () => ({ appVersionLabel: jest.fn(() => '0.0.147 (build 143)') }));

const apk = { name: 'Atlas-144.apk', browser_download_url: 'https://example.test/Atlas-144.apk', size: 258_000_000 };
const release = (over: object = {}) => ({ tag_name: 'atlas-144', name: 'Atlas build 144', draft: false, prerelease: false, body: 'notes', assets: [apk], ...over });

describe('knowing about a newer Atlas', () => {
  it('reads the build number from the version name and from a release tag', () => {
    expect(buildFromVersion('0.0.147 (build 143)')).toBe(143);
    expect(buildFromVersion('0.0.147')).toBeNull();
    expect(buildFromVersion(undefined)).toBeNull();
    expect(buildFromTag('atlas-144')).toBe(144);
    expect(buildFromTag('atlas-library')).toBeNull();
    expect(buildFromTag('v1.2.3')).toBeNull();
  });
  it('offers a release only when it is a higher build with an APK', () => {
    expect(updateFromRelease(release(), 143)).toMatchObject({ build: 144, apkUrl: apk.browser_download_url, size: apk.size });
    expect(updateFromRelease(release(), 144)).toBeNull(); // same build
    expect(updateFromRelease(release(), 150)).toBeNull(); // this build is newer
    expect(updateFromRelease(release({ assets: [] }), 143)).toBeNull();
    expect(updateFromRelease(release({ prerelease: true }), 143)).toBeNull();
    expect(updateFromRelease(release({ draft: true }), 143)).toBeNull();
    expect(updateFromRelease(release({ tag_name: 'atlas-library' }), 143)).toBeNull();
  });
  it('leaves the install blurb out of what is new', () => {
    expect(updateFromRelease(release({ body: 'Install this APK on your phone.\nFixed the briefing.' }), 143)?.notes).toBe('Fixed the briefing.');
  });
  it('says nothing when this build does not know its own number', () => {
    expect(updateFromRelease(release(), null)).toBeNull();
  });
  it('asks GitHub for the latest release and compares it with the installed build', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => release() }));
    (global as any).fetch = fetchMock;
    const r = await checkForUpdate();
    expect(String((fetchMock.mock.calls as any)[0][0])).toContain('/repos/coolchan03/Atlas/releases/latest');
    expect(r.current).toBe(143);
    expect(r.update?.build).toBe(144);
  });
  it('treats no published release as nothing to update, and a server error as an error', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    expect((await checkForUpdate()).update).toBeNull();
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(checkForUpdate()).rejects.toThrow('HTTP 500');
  });
});
