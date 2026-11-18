import { NextResponse, type NextRequest } from 'next/server';
import { createRateLimiter, getClientIp } from '@/lib/rate-limit';
import { buildRateLimitBody } from '@/lib/rate-limit-message';

// Module scope: this Map lives as long as this Node process does. That is the whole
// "in-memory" design. Next's proxy docs say not to rely on shared globals when proxy is
// deployed apart from the app (a CDN, or a new serverless instance per request). On one
// long-lived `next start` process this limit holds; elsewhere it is a speed bump.
const limiter = createRateLimiter({
  limit: 5, // POSTs per window. Each Analyze and each "Generate fixes" is one POST.
  windowMs: 15 * 60 * 1000,
  maxKeys: 10_000,
});

// Next 16 renamed the middleware file convention to proxy (nodejs runtime, not edge).
export function proxy(request: NextRequest): NextResponse {
  // A Server Action call is a POST to the URL of the page that uses it. We can't match on
  // method in `config.matcher`, and matching on the `Next-Action` header alone would miss
  // plain form-encoded action POSTs, so the matcher selects by path and we decide here.
  // Page navigations are GETs: they fall straight through, uncounted.
  if (request.method !== 'POST') return NextResponse.next();

  const { allowed, retryAfterSeconds } = limiter.check(getClientIp(request.headers));
  if (allowed) return NextResponse.next();

  // Next 16.3.8's server-action-reducer.js uses this body as the thrown Error message
  // only when status >= 400 and Content-Type is exactly `text/plain`. Any other type
  // becomes "An unexpected response was received from the server."
  return new NextResponse(buildRateLimitBody(retryAfterSeconds), {
    status: 429,
    headers: {
      'Content-Type': 'text/plain',
      'Retry-After': String(retryAfterSeconds), // standard header, useful for non-browser clients
      'Cache-Control': 'no-store',
    },
  });
}

export const config = {
  // Skip static assets so they never invoke this function. Don't exclude the page paths:
  // the Server Actions are POSTs to them.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml)$).*)',
  ],
};
