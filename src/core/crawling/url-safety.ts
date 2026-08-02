// Blocks SSRF: prevents any real network fetch in this codebase (crawler,
// audit fetch, etc.) from being pointed at internal/private infrastructure
// (loopback, RFC1918, link-local incl. the 169.254.169.254 cloud metadata
// address, etc.) via a user-supplied URL or via a redirect chain that hops
// there. This is the canonical implementation; web/src/server/backend/
// url-safety.ts re-exports it so there is exactly one copy of this logic.

import { promises as dns } from "node:dns";
import { isIP } from "node:net";

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function cidrToRange(cidr: string): [number, number] {
  const [base = "0.0.0.0", bitsStr = "32"] = cidr.split("/");
  const bits = Number(bitsStr);
  const size = 32 - bits;
  const start = size >= 32 ? 0 : (ipv4ToInt(base) & (~0 << size)) >>> 0;
  const end = size >= 32 ? 0xffffffff : (start | ((1 << size) - 1)) >>> 0;
  return [start, end];
}

const BLOCKED_V4_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

const BLOCKED_V4_RANGES = BLOCKED_V4_CIDRS.map(cidrToRange);

function isBlockedIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return BLOCKED_V4_RANGES.some(([start, end]) => value >= start && value <= end);
}

function isBlockedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isBlockedIPv4(mapped[1]);
  return false;
}

function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIPv4(ip);
  if (version === 6) return isBlockedIPv6(ip);
  return true;
}

/**
 * Validates that `rawUrl` is a well-formed http(s) URL that does not resolve
 * to a private/loopback/link-local/reserved address. Throws a user-safe
 * Error otherwise. Call this again for every redirect hop.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are allowed.");
  }
  const hostname = parsed.hostname;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("That URL points to a local address and cannot be audited.");
  }

  const directIpVersion = isIP(hostname);
  let addresses: string[];
  if (directIpVersion) {
    addresses = [hostname];
  } else {
    try {
      addresses = (await dns.lookup(hostname, { all: true })).map((entry) => entry.address);
    } catch {
      throw new Error("Could not resolve that URL's host.");
    }
  }

  if (addresses.length === 0 || addresses.some((address) => isBlockedIp(address))) {
    throw new Error("That URL points to a private or internal address and cannot be audited.");
  }

  return parsed;
}
