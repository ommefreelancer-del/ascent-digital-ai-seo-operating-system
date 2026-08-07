// Best-effort, single-instance, in-memory rate limiting for auth endpoints
// (login, register, forgot/reset password). Sufficient to blunt casual
// brute-force / enumeration / spam on a single-instance deployment.
// A multi-instance production deployment should replace this with a shared
// store (e.g. Redis/Upstash) so limits are enforced across instances.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function sweep(now: number) {
  if (buckets.size < 10_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Returns true if the action is allowed, false if the key has exceeded `limit` within `windowMs`. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) {
    return false;
  }
  bucket.count += 1;
  return true;
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function getClientIpFromHeaderRecord(headers: Record<string, unknown> | undefined | null): string {
  if (!headers) return "unknown";
  const forwarded = headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) return forwarded.split(",")[0]?.trim() || "unknown";
  const real = headers["x-real-ip"];
  return typeof real === "string" && real.length > 0 ? real : "unknown";
}
