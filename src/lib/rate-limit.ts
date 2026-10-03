// Pure module: no Next.js imports. That keeps it unit-testable, and it means swapping this
// in-memory store for Redis later only touches this file, not the proxy.

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry (0 when allowed). */
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  limit: number; // max requests per window
  windowMs: number;
  maxKeys: number; // hard cap on tracked IPs, so memory can't grow without bound
}

export interface RateLimiter {
  check: (key: string, now?: number) => RateLimitResult;
  size: () => number;
}

const SWEEP_INTERVAL_MS = 60_000;

export function createRateLimiter({ limit, windowMs, maxKeys }: RateLimiterOptions): RateLimiter {
  // key -> timestamps (ms) of that key's recent allowed requests, oldest first.
  // Never longer than `limit`, so memory per IP is a handful of numbers.
  const hits = new Map<string, number[]>();
  let lastSweep = 0;

  // Lazy cleanup on the request path: no setInterval, which isn't reliable in every runtime.
  function sweep(now: number): void {
    for (const [key, stamps] of hits) {
      const newest = stamps[stamps.length - 1];
      if (newest === undefined || now - newest >= windowMs) hits.delete(key);
    }
    lastSweep = now;
  }

  function check(key: string, now: number = Date.now()): RateLimitResult {
    if (now - lastSweep >= SWEEP_INTERVAL_MS) sweep(now);

    // Sliding-window log: keep only timestamps still inside the window. Unlike a fixed
    // window, a client can't burst 5 at 14:59 and 5 more at 15:01.
    const stamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

    if (stamps.length >= limit) {
      hits.set(key, stamps);
      // Rejected requests are NOT recorded, so hammering the endpoint doesn't extend the lockout.
      const oldest = stamps[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
      };
    }

    stamps.push(now);
    // delete + set moves the key to the END of the Map's insertion order, so the FIRST key
    // is always the least recently used one, which is what we evict at the cap.
    hits.delete(key);
    hits.set(key, stamps);

    if (hits.size > maxKeys) {
      const leastRecent = hits.keys().next().value;
      if (leastRecent !== undefined) hits.delete(leastRecent);
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  return { check, size: () => hits.size };
}

// ---------- Client IP ----------

/** How many reverse proxies you control between the internet and this app (e.g. Vercel = 1). */
const TRUSTED_PROXY_COUNT = 1;

// SECURITY: X-Forwarded-For is just a header, so a client can send anything in it. Only
// entries appended by YOUR proxies are trustworthy, and those sit at the right end of the
// list. We therefore count from the right instead of taking the first (spoofable) entry.
// This is only safe behind a proxy that sets or appends the header (Vercel, nginx, a load
// balancer). If the app is exposed directly, anyone can pick their own "IP".
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
    const ip = parts[Math.max(0, parts.length - TRUSTED_PROXY_COUNT)];
    if (ip) return ip;
  }
  const real = headers.get('x-real-ip')?.trim();
  // 'unknown' is one shared bucket (e.g. local dev): fail closed rather than skip limiting.
  return real ? real : 'unknown';
}
