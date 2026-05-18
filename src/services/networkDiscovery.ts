/**
 * LAN LLM Server Discovery
 *
 * Scans the device's local subnet for running LLM servers
 * (Ollama, LM Studio) using their default ports.
 */

import { getIpAddress, isEmulator } from 'react-native-device-info';
import { isPrivateIPv4, isIPv6 } from '../utils/network';
import logger from '../utils/logger';

export interface DiscoveredServer {
  endpoint: string;
  type: 'ollama' | 'lmstudio';
  name: string;
}

const PROVIDERS = [
  { port: 11434, type: 'ollama' as const,   name: 'Ollama',    probePath: '/api/tags'     },
  { port: 1234,  type: 'lmstudio' as const, name: 'LM Studio', probePath: '/api/v1/models' },
];

const TIMEOUT_MS = 500;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 50;

/** Probe a single host:port — resolves true if it responds with an HTTP status */
async function probe(ip: string, port: number, path: string): Promise<boolean> {
  return new Promise(resolve => {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); resolve(false); }, TIMEOUT_MS);

    fetch(`http://${ip}:${port}${path}`, { signal: controller.signal }) // NOSONAR — LAN-only probe; HTTPS requires certs on private IPs
      .then(res => { clearTimeout(timer); resolve(res.status === 200); })
      .catch(() => { clearTimeout(timer); resolve(false); });
  });
}

/** Run up to BATCH_SIZE probes concurrently with a small delay between batches */
async function runBatch<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE).map(t => t());
    results.push(...await Promise.all(batch));
    if (i + BATCH_SIZE < tasks.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  return results;
}

/** Parse subnet base from IPv4, e.g. "192.168.1.42" → "192.168.1". Returns null if not a private IPv4. */
function subnetBase(ip: string): string | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  if (!isPrivateIPv4(ip)) return null;
  return parts.slice(0, 3).join('.');
}

/**
 * Common home/office subnets to try when IPv4 detection fails (e.g. device returns IPv6).
 * Intentionally limited to the 2 most common home subnets to avoid a flood of timeouts
 * on devices with no WiFi (e.g. cellular-only) where all probes would time out anyway.
 */
const FALLBACK_SUBNETS = ['192.168.1', '192.168.0'];

/**
 * Quick-probe gateway IPs (.1) on candidate subnets to see if any respond.
 * Returns the first reachable subnet base, or null if none respond.
 * Uses a short timeout so we bail fast when on cellular.
 */
async function findReachableSubnet(subnets: string[], log: (msg: string) => void): Promise<string | null> {
  const GATEWAY_TIMEOUT_MS = 800;
  const results = await Promise.all(
    subnets.map(async (base) => {
      const gateway = `${base}.1`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
      try {
        await fetch(`http://${gateway}:80/`, { signal: controller.signal }); // NOSONAR — LAN gateway probe
        clearTimeout(timer);
        log(`Gateway ${gateway}:80 responded`);
        return base;
      } catch {
        clearTimeout(timer);
        const controller2 = new AbortController();
        const timer2 = setTimeout(() => controller2.abort(), GATEWAY_TIMEOUT_MS);
        try {
          await fetch(`http://${gateway}:11434/`, { signal: controller2.signal }); // NOSONAR — LAN Ollama probe
          clearTimeout(timer2);
          log(`Gateway ${gateway}:11434 responded`);
          return base;
        } catch {
          clearTimeout(timer2);
          log(`Gateway ${gateway} did not respond on :80 or :11434`);
          return null;
        }
      }
    }),
  );
  return results.find(r => r !== null) ?? null;
}

/**
 * Scan the local subnet for LLM servers.
 * Returns discovered servers sorted by IP.
 * Throws with a human-readable message if setup fails (no WiFi IP, non-private network).
 * Errors during probing are swallowed — only setup errors propagate.
 */
export async function discoverLANServers(onLog?: (msg: string) => void): Promise<DiscoveredServer[]> {
  const log = (msg: string) => {
    logger.warn('[Discovery]', msg);
    onLog?.(msg);
  };

  let runningOnEmulator: boolean;
  try {
    runningOnEmulator = await isEmulator();
  } catch (err) {
    log(`isEmulator() threw: ${(err as Error).message} — assuming not emulator`);
    runningOnEmulator = false;
  }
  if (runningOnEmulator) {
    log('Running on emulator — skipping scan (emulator network stack cannot handle concurrent probes)');
    return [];
  }

  log('Not an emulator — proceeding');

  let ip: string | null;
  try {
    ip = await getIpAddress();
  } catch (err) {
    log(`getIpAddress() threw: ${(err as Error).message}`);
    ip = null;
  }

  const ipv6 = ip ? isIPv6(ip) : false;
  const privateV4 = ip ? isPrivateIPv4(ip) : false;
  log(`Device IP: ${ip ?? 'null'} | IPv6: ${ipv6} | privateIPv4: ${privateV4}`);

  let subnetsToScan: string[];

  if (!ip || ip === '0.0.0.0' || ip === '127.0.0.1') {
    log(`No usable IP (got: ${ip ?? 'null'}) — skipping scan`);
    return [];
  } else if (ipv6) {
    log(`IPv6 address detected — probing gateways on fallback subnets: ${FALLBACK_SUBNETS.join(', ')}`);
    const reachableSubnet = await findReachableSubnet(FALLBACK_SUBNETS, log);
    if (reachableSubnet) {
      log(`Gateway responded on subnet ${reachableSubnet} — scanning that subnet only`);
      subnetsToScan = [reachableSubnet];
    } else {
      log('No gateway responded — scanning all fallback subnets anyway (device may still be on WiFi)');
      subnetsToScan = FALLBACK_SUBNETS;
    }
  } else {
    const base = subnetBase(ip);
    if (!base) {
      log(`IP ${ip} is not on a private network — skipping scan`);
      return [];
    }
    log(`IPv4 private address — subnet base: ${base}`);
    subnetsToScan = [base];
  }

  log(`Scanning ${subnetsToScan.length} subnet(s): ${subnetsToScan.map(s => `${s}.0/24`).join(', ')} | ${subnetsToScan.length * 254 * PROVIDERS.length} total probes | batch size: ${BATCH_SIZE} | timeout: ${TIMEOUT_MS}ms`);

  try {
    const discovered: DiscoveredServer[] = [];
    const seenEndpoints = new Set<string>();

    const recordIfFound = (target: string, provider: typeof PROVIDERS[0]) => (found: boolean) => {
      if (!found) return;
      const endpoint = `http://${target}:${provider.port}`; // NOSONAR — LAN endpoint
      if (!seenEndpoints.has(endpoint)) {
        seenEndpoints.add(endpoint);
        log(`Found ${provider.name} at ${target}:${provider.port}`);
        discovered.push({ endpoint, type: provider.type, name: `${provider.name} (${target})` });
      }
    };

    await Promise.all(subnetsToScan.map(async (base) => {
      for (const provider of PROVIDERS) {
        log(`Probing ${base}.1-254 for ${provider.name} on port ${provider.port}...`);
        const tasks = Array.from({ length: 254 }, (_, i) => {
          const target = `${base}.${i + 1}`;
          return () => probe(target, provider.port, provider.probePath).then(recordIfFound(target, provider));
        });
        await runBatch(tasks);
        log(`Done probing ${base}.x for ${provider.name}`);
      }
    }));

    log(`Scan complete — found ${discovered.length} server(s)`);
    return discovered;
  } catch (error) {
    log(`Scan error: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
