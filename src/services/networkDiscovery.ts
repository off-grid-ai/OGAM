/**
 * LAN LLM Server Discovery
 *
 * Scans the device's local subnet for running LLM servers
 * (Ollama, LM Studio, Off Grid AI Gateway) using their default ports.
 */

import { getIpAddress, isEmulator } from 'react-native-device-info';
import { isPrivateIPv4, isIPv6 } from '../utils/network';
import logger from '../utils/logger';

export interface DiscoveredServer {
  endpoint: string;
  type: 'ollama' | 'lmstudio' | 'gateway';
  name: string;
  /** Off Grid AI Desktop answered, but it requires an API key before it lists models. */
  needsKey?: boolean;
}

export type DiscoverableServerKind = DiscoveredServer['type'];

export interface DiscoveryOptions {
  kinds?: readonly DiscoverableServerKind[];
  onFound?: (server: DiscoveredServer) => void;
  onProgress?: (completed: number, total: number) => void;
}

// Probe paths match exactly where the app later reads models from
// (see fetchModelsFromServer): OpenAI-compatible servers expose /v1/models,
// Ollama answers its native /api/tags. So a successful probe means the data the
// app needs is actually there, not just that the port is open.
const PROVIDERS = [
  { port: 11434, type: 'ollama' as const,   name: 'Ollama',                probePath: '/api/tags'  },
  { port: 1234,  type: 'lmstudio' as const, name: 'LM Studio',             probePath: '/v1/models' },
  // Off Grid AI Gateway runs on the user's laptop on the same LAN, so it is
  // probed across the subnet on its fixed port just like the others.
  { port: 7878,  type: 'gateway' as const,  name: 'Off Grid AI Gateway',   probePath: '/v1/models' },
];

/**
 * How long a host gets to answer before we call it silent.
 *
 * 500ms was tighter than a real Wi-Fi round trip and the scan reported an empty network while
 * the server was right there: an Off Grid AI Desktop on the same subnet answered /v1/models in
 * 133, 285, 292, 454 and 676ms across five tries from a phone doing nothing else. Half of those
 * lose to a 500ms deadline, and a sweep runs many probes at once, which only stretches them
 * further. A dead address is refused immediately rather than waiting out the deadline, so the
 * extra budget is spent almost entirely on hosts that are genuinely silent.
 */
const TIMEOUT_MS = 2000;

/**
 * How many probes may be in flight at once, across every provider and subnet.
 *
 * Android runs `fetch` on one shared OkHttp dispatcher, and that dispatcher runs 64 requests at a
 * time. It does not refuse the rest; it QUEUES them. A queued probe is still counted against its
 * own deadline, because the abort timer starts when we call fetch and not when the request leaves
 * the phone. So asking for more than the dispatcher will run does not scan faster - it makes the
 * extra probes expire in the queue and report a silent network.
 *
 * 48 keeps the whole sweep inside that limit with room for the app's own traffic.
 */
const MAX_IN_FLIGHT = 48;

/** GET a LAN URL with the probe deadline. Resolves the response, or null when silent or refused. */
function fetchWithDeadline(url: string): Promise<Response | null> {
  return new Promise(resolve => {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); resolve(null); }, TIMEOUT_MS);

    fetch(url, { signal: controller.signal }) // NOSONAR — LAN-only probe; HTTPS requires certs on private IPs
      .then(res => { clearTimeout(timer); resolve(res); })
      .catch(() => { clearTimeout(timer); resolve(null); });
  });
}

type ProbeResult = 'found' | 'needs-key' | 'none';

/**
 * Probe a single host:port. A 200 on the provider's model path is a server we can use as it is.
 *
 * Off Grid AI Desktop can require an API key, and then /v1/models answers 401 to a phone that has
 * none. Its /health page stays open in that mode, so a 401 on the gateway port is confirmed there:
 * the phone still finds the desktop and asks the person for the key, instead of reporting an empty
 * network.
 */
async function probe(ip: string, provider: typeof PROVIDERS[number]): Promise<ProbeResult> {
  const base = `http://${ip}:${provider.port}`; // NOSONAR — LAN endpoint
  const res = await fetchWithDeadline(`${base}${provider.probePath}`);
  if (res?.status === 200) return 'found';
  if (res?.status !== 401 || provider.type !== 'gateway') return 'none';
  const health = await fetchWithDeadline(`${base}/health`);
  if (health?.status !== 200) return 'none';
  try {
    const body = await health.json();
    return typeof body?.name === 'string' && body.name.startsWith('Off Grid AI') ? 'needs-key' : 'none';
  } catch {
    return 'none';
  }
}

/**
 * Run the probes with a fixed number in flight, starting the next one as soon as a slot frees.
 *
 * Fixed batches waited for the slowest probe in each group of 50 before starting any of the next
 * 50, so one silent address held 49 free slots idle for the whole deadline. A pool of workers
 * pulling from one queue keeps every slot busy, which is what pays for a deadline long enough to
 * be correct.
 */
async function runPool(tasks: (() => Promise<void>)[]): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(MAX_IN_FLIGHT, tasks.length) },
    async () => {
      while (next < tasks.length) {
        const task = tasks[next++];
        if (task) await task();
      }
    },
  );
  await Promise.all(workers);
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
export async function discoverLANServers(
  onLog?: (msg: string) => void,
  options: DiscoveryOptions = {},
): Promise<DiscoveredServer[]> {
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

  const selectedProviders = options.kinds?.length
    ? PROVIDERS.filter(provider => options.kinds?.includes(provider.type))
    : PROVIDERS;
  const total = subnetsToScan.length * 254 * selectedProviders.length;
  let completed = 0;
  options.onProgress?.(completed, total);
  log(`Scanning ${subnetsToScan.length} subnet(s): ${subnetsToScan.map(s => `${s}.0/24`).join(', ')} | ${total} total probes | in flight: ${MAX_IN_FLIGHT} | timeout: ${TIMEOUT_MS}ms`);

  try {
    const discovered: DiscoveredServer[] = [];
    const seenEndpoints = new Set<string>();

    const recordIfFound = (target: string, provider: typeof PROVIDERS[0]) => (result: ProbeResult) => {
      if (result === 'none') return;
      const endpoint = `http://${target}:${provider.port}`; // NOSONAR — LAN endpoint
      if (!seenEndpoints.has(endpoint)) {
        seenEndpoints.add(endpoint);
        const keyNote = result === 'needs-key' ? ' (API key required)' : '';
        log(`Found ${provider.name} at ${target}:${provider.port}${keyNote}`);
        const server: DiscoveredServer = {
          endpoint,
          type: provider.type,
          name: `${provider.name} (${target})`,
          ...(result === 'needs-key' ? { needsKey: true } : {}),
        };
        discovered.push(server);
        options.onFound?.(server);
      }
    };

    // One queue for the whole scan, not one per provider. Three provider sweeps running at once
    // put three times MAX_IN_FLIGHT probes on Android's shared dispatcher, and everything above
    // its limit sat in a queue until its own deadline expired - a full network reported as empty.
    // iOS hid this: it caps connections PER HOST, and every probe is a different host.
    //
    // Off Grid's own port goes first, so the server this app exists to find is the earliest thing
    // reported rather than the last.
    const ordered = [...selectedProviders].sort(
      (a, b) => Number(b.type === 'gateway') - Number(a.type === 'gateway'),
    );
    const tasks = subnetsToScan.flatMap((base) =>
      ordered.flatMap((provider) =>
        Array.from({ length: 254 }, (_, i) => {
          const target = `${base}.${i + 1}`;
          return async () => {
            try {
              recordIfFound(target, provider)(await probe(target, provider));
            } finally {
              options.onProgress?.(++completed, total);
            }
          };
        }),
      ),
    );
    await runPool(tasks);

    log(`Scan complete — found ${discovered.length} server(s)`);
    return discovered;
  } catch (error) {
    log(`Scan error: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
