/** Returns true if the IPv4 address belongs to a private (RFC 1918) network */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const first = parseInt(parts[0], 10);
  const second = parseInt(parts[1], 10);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

/** Returns true if the string looks like an IPv6 address */
export function isIPv6(ip: string): boolean {
  return ip.includes(':');
}
