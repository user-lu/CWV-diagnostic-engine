import 'server-only'; // keeps the crawler out of client bundles

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Messages on this error are written for end users and safe to display. */
export class CrawlError extends Error {}

const MAX_REDIRECTS = 5;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB of HTML is plenty; protects server memory
const TIMEOUT_MS = 10_000; // one budget for all redirect hops + body download

// ---------- SSRF guard: refuse anything that isn't a public internet address ----------

function isPrivateIPv4(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number);
  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local (cloud metadata lives here)
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved
  );
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  // IPv4-mapped (::ffff:127.0.0.1): judge the embedded IPv4 address.
  const mappedDotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isPrivateIPv4(mappedDotted[1]);
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }

  if (lower.startsWith('::')) return true; // unspecified (::), loopback (::1), compat forms
  const first = parseInt(lower.split(':')[0] || '0', 16);
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xff00) === 0xff00 // ff00::/8 multicast
  );
}

function isPrivateAddress(ip: string): boolean {
  return isIP(ip) === 4 ? isPrivateIPv4(ip) : isPrivateIPv6(ip);
}

// Runs on the initial URL AND on every redirect target. An attacker's public site
// can 302 to http://169.254.169.254, so validating only the first URL isn't enough.
async function assertPublicUrl(raw: string): Promise<void> {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CrawlError('Only http(s) URLs can be crawled.');
  }
  if (url.username || url.password) {
    throw new CrawlError('URLs with embedded credentials are not allowed.');
  }
  // Default ports only: stops the crawler being used to probe internal services (e.g. :6379).
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new CrawlError('Only the default HTTP and HTTPS ports are allowed.');
  }

  const host = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      // `all: true`: a hostname may have several records; every one must be public.
      addresses = (await lookup(host, { all: true })).map((r) => r.address);
    } catch {
      throw new CrawlError('Could not resolve that hostname.');
    }
  }

  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new CrawlError('That address is not allowed.');
  }
}

// ---------- Fetch with manual redirects and a hard size cap ----------

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8'); // assumes UTF-8; fine for most of the modern web
  let received = 0;
  let html = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BYTES) {
      await reader.cancel(); // stop downloading immediately
      throw new CrawlError('That page is too large to analyze (over 2 MB of HTML).');
    }
    html += decoder.decode(value, { stream: true });
  }
  return html + decoder.decode();
}

export async function fetchHtml(startUrl: string): Promise<{ html: string; finalUrl: string }> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current);

    let res: Response;
    try {
      res = await fetch(current, {
        // 'manual' = we follow redirects ourselves so each hop passes assertPublicUrl.
        // The default ('follow') would happily chase a redirect into your private network.
        redirect: 'manual',
        cache: 'no-store',
        signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TechnicalHealthBot/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') throw err;
      throw new CrawlError('Could not connect to that site.');
    }

    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel(); // don't download redirect bodies
      const location = res.headers.get('location');
      if (!location) throw new CrawlError('The site sent a redirect with no destination.');
      try {
        current = new URL(location, current).toString(); // Location may be relative
      } catch {
        throw new CrawlError('The site sent an invalid redirect.');
      }
      continue;
    }

    if (!res.ok) throw new CrawlError(`The page returned HTTP ${res.status}.`);

    const type = res.headers.get('content-type') ?? '';
    if (type && !/html/i.test(type)) {
      throw new CrawlError('That URL did not return an HTML page.');
    }

    return { html: await readCapped(res), finalUrl: current };
  }

  throw new CrawlError('Too many redirects.');
}
