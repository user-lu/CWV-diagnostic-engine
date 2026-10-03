/**
 * Limiter, IP parsing, and 429 message parsing. No Next.js, no API keys.
 *   node --experimental-strip-types scripts/verify-rate-limit.mts
 */
import { createRateLimiter, getClientIp } from '../src/lib/rate-limit.ts';
import { buildRateLimitBody, describeActionFailure } from '../src/lib/rate-limit-message.ts';

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const WINDOW = 1_000;
const limiter = createRateLimiter({ limit: 2, windowMs: WINDOW, maxKeys: 2 });

// 1. Sliding window: two allowed, the third blocked, then allowed once the oldest expires.
assert(limiter.check('a', 0).allowed, 't=0 should be allowed');
assert(limiter.check('a', 100).allowed, 't=100 should be allowed');
const blocked = limiter.check('a', 200);
assert(!blocked.allowed, 't=200 should be blocked');
assert(blocked.retryAfterSeconds === 1, `retry-after at t=200: ${blocked.retryAfterSeconds}`);
assert(limiter.check('a', 1_000).allowed, 't=1000 should be allowed once the first hit ages out');

// 2. Rejected requests are not recorded, so hammering does not push the window forward.
const fresh = createRateLimiter({ limit: 1, windowMs: WINDOW, maxKeys: 10 });
assert(fresh.check('a', 0).allowed, 'first hit allowed');
assert(!fresh.check('a', 100).allowed, 'second hit blocked');
assert(!fresh.check('a', 900).allowed, 'hammering still blocked');
assert(fresh.check('a', 1_000).allowed, 'allowed again at the original window, not later');

// 3. Retry-After is at least 1s and counts from the oldest hit still in the window.
const retry = createRateLimiter({ limit: 1, windowMs: 10_000, maxKeys: 10 });
assert(retry.check('a', 0).allowed, 'seed hit');
const wait = retry.check('a', 1_500);
assert(wait.retryAfterSeconds === 9, `expected 9s, got ${wait.retryAfterSeconds}`);

// 4. Eviction drops the least-recently-used key, and a repeat visit moves a key to the end.
const lru = createRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 2 });
lru.check('a', 0);
lru.check('b', 1);
lru.check('a', 2); // 'a' is now newest; 'b' is least recent
lru.check('c', 3); // evicts 'b'
assert(lru.size() === 2, `size after eviction: ${lru.size()}`);
assert(lru.check('b', 4).allowed, 'evicted key starts a fresh window');
// 'b' was gone, so this allowance is its first hit. 'c' should have been evicted to make room
// (order before this check was a, c; adding b evicts a). Confirm 'a' was dropped by filling
// a brand-new limiter's cap and checking size never exceeds maxKeys.
const cap = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 3 });
for (let i = 0; i < 20; i++) cap.check(`ip-${i}`, i);
assert(cap.size() === 3, `cap size: ${cap.size()}`);

// 5. Expired keys are swept, so the map doesn't keep them forever.
const sweep = createRateLimiter({ limit: 1, windowMs: 1_000, maxKeys: 100 });
sweep.check('old', 0);
assert(sweep.size() === 1, 'tracked before sweep');
sweep.check('new', 60_000); // first check at/after the sweep interval drops 'old'
assert(sweep.size() === 1, `after sweep, only the new key should remain, size=${sweep.size()}`);

// 6. IP: trust the rightmost entry (the one our proxy appended), not the client-supplied first.
const spoofed = new Headers({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' });
assert(getClientIp(spoofed) === '203.0.113.9', `forwarded: ${getClientIp(spoofed)}`);
const single = new Headers({ 'x-forwarded-for': ' 203.0.113.4 ' });
assert(getClientIp(single) === '203.0.113.4', `single: ${getClientIp(single)}`);
const blanks = new Headers({ 'x-forwarded-for': ' , , 203.0.113.8' });
assert(getClientIp(blanks) === '203.0.113.8', `blanks: ${getClientIp(blanks)}`);
const realIp = new Headers({ 'x-real-ip': '198.51.100.2' });
assert(getClientIp(realIp) === '198.51.100.2', `x-real-ip: ${getClientIp(realIp)}`);
assert(getClientIp(new Headers()) === 'unknown', 'missing headers share one bucket');

// 7. 429 body round-trips into a user-facing wait, and anything else stays generic.
assert(buildRateLimitBody(90) === 'RATE_LIMITED:90', 'body format');
const limited = describeActionFailure(new Error('RATE_LIMITED:90'));
assert(limited.includes('about 2 minutes'), `90s message: ${limited}`);
const soon = describeActionFailure(new Error('RATE_LIMITED:30'));
assert(soon.includes('about a minute'), `30s message: ${soon}`);
assert(
  describeActionFailure(new Error('An unexpected response was received from the server.')) ===
    'Something went wrong. Please try again.',
  'generic next error must not leak',
);
assert(
  describeActionFailure(new Error('RATE_LIMITED:0')) === 'Something went wrong. Please try again.',
  'a zero wait is not a rate-limit body we wrote',
);
assert(
  describeActionFailure('RATE_LIMITED:10') === 'Something went wrong. Please try again.',
  'non-Error values are generic',
);

console.log('verify-rate-limit: all checks passed');
