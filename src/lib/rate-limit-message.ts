// The "wire format" shared by the proxy (which writes the 429 body) and the UI (which
// reads it back). Pure functions only, so it is safe to import from server AND client code.

const PREFIX = 'RATE_LIMITED:';

/** Body text the proxy sends with a 429. */
export function buildRateLimitBody(retryAfterSeconds: number): string {
  return `${PREFIX}${retryAfterSeconds}`;
}

// Next's client throws `new Error(<response body>)` when a Server Action gets a non-RSC
// 4xx/5xx response whose content-type is exactly text/plain. So a rate-limited call
// arrives here as an Error whose message is our body.
function parseRetryAfterSeconds(err: unknown): number | null {
  if (!(err instanceof Error) || !err.message.startsWith(PREFIX)) return null;
  const seconds = Number.parseInt(err.message.slice(PREFIX.length), 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function formatWait(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? 'about a minute' : `about ${minutes} minutes`;
}

/** Turns anything a Server Action call can throw into a message that is safe to show. */
export function describeActionFailure(err: unknown): string {
  const retry = parseRetryAfterSeconds(err);
  if (retry !== null) {
    return `You've reached the request limit. Please try again in ${formatWait(retry)}.`;
  }
  return 'Something went wrong. Please try again.';
}
