/**
 * The request never reached the server or got no answer: the network dropped, the server is off or
 * unreachable, or it timed out. A short drop on the same Wi-Fi ends this way too, so a caller may try
 * the same server again. A server that answered with an error is not a network failure.
 */
const NETWORK_FAILURE =
  /network error|request timeout|network request failed|failed to fetch|fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/i;

export function isNetworkFailure(reason: unknown): boolean {
  return reason instanceof Error && NETWORK_FAILURE.test(reason.message);
}
