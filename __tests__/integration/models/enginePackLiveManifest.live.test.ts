/**
 * The live engine-pack manifest verifies with the key the app pins.
 *
 * Every other engine-pack test signs with a key it makes itself. This one reads the real
 * manifest.json and manifest.json.sig the fork publishes and checks them with the app's pinned key,
 * through the app's own verifyManifest. It fails when the key, the signature or the manifest
 * format drifts, or when the published packs no longer fit this app build.
 *
 * jest.setup.ts turns global fetch off so tests stay offline by accident; this test is online on
 * purpose, through node's https.
 */
import https from 'https';
import { ENGINE_PACK_SOURCE } from '../../../src/services/enginePacks';
import { verifyManifest } from '../../../src/services/enginePacks/manifest';

const appLlamaRn = require('../../../node_modules/llama.rn/package.json');
const appReactNative = require('../../../node_modules/react-native/package.json').version;

function get(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { timeout: 20_000 }, res => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`${url} answered ${res.statusCode}`));
          return;
        }
        res.setEncoding('utf8');
        let body = '';
        res.on('data', chunk => (body += chunk));
        res.on('end', () => resolve(body));
      })
      .on('timeout', function onTimeout(this: { destroy(e: Error): void }) {
        this.destroy(new Error(`${url} timed out`));
      })
      .on('error', reject);
  });
}

describe('the live engine-pack manifest', () => {
  it("verifies with the app's pinned key and offers packs this build can load", async () => {
    const [body, signature] = await Promise.all([
      get(ENGINE_PACK_SOURCE.manifestUrl),
      get(`${ENGINE_PACK_SOURCE.manifestUrl}.sig`),
    ]);
    const packs = verifyManifest(body, signature, ENGINE_PACK_SOURCE.publicKey);

    expect(packs.map(p => p.abi)).toContain('arm64-v8a');
    for (const pack of packs) {
      expect(pack.reactNative).toBe(appReactNative);
      expect(pack.bridge).toBe(appLlamaRn.offgrid.engineBridge);
      expect(pack.llamaBuild).toBeGreaterThanOrEqual(Number(appLlamaRn.offgrid.llamaCpp.replace(/^b/, '')));
    }
  }, 60_000);

  it('refuses the live manifest under any other key', async () => {
    const [body, signature] = await Promise.all([
      get(ENGINE_PACK_SOURCE.manifestUrl),
      get(`${ENGINE_PACK_SOURCE.manifestUrl}.sig`),
    ]);
    const otherKey = Buffer.alloc(32, 7).toString('base64');
    expect(() => verifyManifest(body, signature, otherKey)).toThrow('signature does not match');
  }, 60_000);
});
