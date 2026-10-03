import 'server-only'; // build fails if a client file ever imports this (protects the API key)

import * as cheerio from 'cheerio';
import { z } from 'zod';
import type {
  DiagnosticResult,
  FieldMetrics,
  LabMetrics,
  LcpElement,
  LoadingExperience,
  MetricReading,
  PageSpeedApiError,
  PageSpeedApiResponse,
  Rating,
  Strategy,
} from '@/types/pagespeed';

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

export class PageSpeedError extends Error {}

// Core Web Vitals thresholds: [good ≤ x] < [needs improvement ≤ y] < [poor].
const THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 }, // ms
  cls: { good: 0.1, poor: 0.25 }, // unitless
  inp: { good: 200, poor: 500 }, // ms
} as const;

type MetricName = keyof typeof THRESHOLDS;

const FORMATTERS: Record<MetricName, (v: number) => string> = {
  lcp: (v) => `${(v / 1000).toFixed(2)} s`,
  cls: (v) => v.toFixed(3),
  inp: (v) => `${Math.round(v)} ms`,
};

function rate(metric: MetricName, value: number): Rating {
  const t = THRESHOLDS[metric];
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'needs-improvement';
  return 'poor';
}

// One place that turns a raw number into a UI-ready reading.
// `undefined` in -> `null` out, so "missing" is explicit all the way to the UI.
function toReading(metric: MetricName, value: number | undefined): MetricReading | null {
  if (value === undefined) return null;
  return { value, displayValue: FORMATTERS[metric](value), rating: rate(metric, value) };
}

function extractLab(audits: PageSpeedApiResponse['lighthouseResult']['audits']): LabMetrics {
  return {
    lcp: toReading('lcp', audits['largest-contentful-paint']?.numericValue),
    cls: toReading('cls', audits['cumulative-layout-shift']?.numericValue),
  };
}

// ---------- LCP element ----------
// Which Lighthouse audit carries the LCP node depends on the Lighthouse version PSI runs:
//   <= 12:  'largest-contentful-paint-element'
//           { type: 'list' | 'table', items: [ ...table rows shaped { node: {...} } ] }
//   >= 13:  that audit is gone; the node lives in the insight 'lcp-breakdown-insight'
//           { type: 'list', items: [ { type: 'table', ...phase timings }, { type: 'node', snippet, selector, ... } ] }
//           (verified against a live PSI response from Lighthouse 13.5.0)
// We try the audits in order and accept either node shape, so a Lighthouse upgrade on
// Google's side doesn't silently turn this feature off. The response is third-party JSON,
// so everything is validated with Zod instead of trusted through a cast.
const LCP_NODE_AUDITS = [
  'largest-contentful-paint-element',
  'lcp-breakdown-insight',
  'lcp-discovery-insight',
] as const;

const nodeFieldsSchema = z.object({
  selector: z.string().optional(),
  snippet: z.string().optional(),
  nodeLabel: z.string().optional(),
});
// A node can arrive wrapped in a table row ({ node }) or bare as a list item ({ type: 'node' }).
const wrappedNodeSchema = z.object({ node: nodeFieldsSchema });
const bareNodeSchema = nodeFieldsSchema.extend({ type: z.literal('node') });
const containerSchema = z.object({ items: z.array(z.unknown()).optional() });

const MAX_DETAILS_DEPTH = 3; // list -> table -> row is 2 levels; 3 leaves headroom, not recursion risk
const MAX_SELECTOR_CHARS = 300;
const MAX_SNIPPET_CHARS = 400;
const MAX_NODE_LABEL_CHARS = 200;
const MAX_IMAGE_URL_CHARS = 2048;

type LighthouseNode = z.infer<typeof nodeFieldsSchema>;

function findFirstNode(details: unknown, depth = 0): LighthouseNode | null {
  if (depth > MAX_DETAILS_DEPTH) return null;
  const container = containerSchema.safeParse(details);
  if (!container.success) return null;

  for (const item of container.data.items ?? []) {
    const wrapped = wrappedNodeSchema.safeParse(item);
    if (wrapped.success) return wrapped.data.node; // a table row holding the node
    const bare = bareNodeSchema.safeParse(item);
    if (bare.success) return bare.data; // a node listed directly
    const nested = findFirstNode(item, depth + 1); // a nested table inside a 'list'
    if (nested) return nested;
  }
  return null;
}

function clipText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Elements whose source URL may appear in their own opening tag. */
const MEDIA_TAGS = new Set(['img', 'video', 'image', 'source']);

/**
 * Pull the image URL out of the node snippet and resolve it to an absolute URL.
 * Snippets can hold relative paths, so we resolve against the page Lighthouse actually loaded.
 * Returns null for text elements and CSS background images (no URL in the node's markup).
 */
function readImageUrl(
  tag: string | null,
  snippet: string,
  baseUrl: string,
): { url: string; truncated: boolean } | null {
  if (tag === null || !MEDIA_TAGS.has(tag)) return null;

  const names = tag === 'image' ? ['href', 'xlink:href'] : ['src', 'poster'];

  // The snippet is only an opening tag. Cheerio decodes entities (&amp; -> &) for us...
  const $ = cheerio.load(snippet, null, false); // false = parse as a fragment, not a full document
  const el = $('*').first();
  let raw: string | undefined;
  for (const name of names) {
    raw = el.attr(name);
    if (raw !== undefined) break;
  }

  // ...but a snippet cut off mid-attribute (`<img src="/a.png" class="very-lo`) is an
  // unterminated tag, which the HTML spec says to DROP, so Cheerio sees nothing. Fall back to
  // reading the attribute straight from the text.
  if (raw === undefined) {
    for (const name of names) {
      const m = snippet.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`, 'i'));
      raw = (m?.[1] ?? m?.[2] ?? m?.[3])?.replaceAll('&amp;', '&');
      if (raw !== undefined) break;
    }
  }

  // Lighthouse shortens long attribute values with a trailing "…" (seen on a real PSI run:
  // src="…/crew-13-docking-still-1.pn…"). Left in, new URL() would percent-encode the "…" into
  // the path, so strip it and remember that this is only a prefix.
  let trimmed = raw?.trim() ?? '';
  const truncated = trimmed.endsWith('…');
  if (truncated) trimmed = trimmed.slice(0, -1);
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed, baseUrl);
    // data: and blob: URLs can't be matched to a crawled <img src>; only http(s) can.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const href = url.toString();
    return href.length <= MAX_IMAGE_URL_CHARS ? { url: href, truncated } : null;
  } catch {
    return null;
  }
}

// Exported so the parsing can be unit-tested against recorded Lighthouse payloads.
export function extractLcpElement(
  audits: PageSpeedApiResponse['lighthouseResult']['audits'],
  baseUrl: string,
): LcpElement | null {
  let node: LighthouseNode | null = null;
  for (const id of LCP_NODE_AUDITS) {
    node = findFirstNode(audits[id]?.details);
    if (node) break;
  }
  if (!node || (!node.snippet && !node.selector)) return null;

  const snippet = node.snippet ?? null;
  const tag = snippet?.match(/^\s*<\s*([a-zA-Z][\w:-]*)/)?.[1]?.toLowerCase() ?? null;

  const image = snippet ? readImageUrl(tag, snippet, baseUrl) : null;

  return {
    tag,
    nodeLabel: node.nodeLabel ? clipText(node.nodeLabel, MAX_NODE_LABEL_CHARS) : null,
    selector: node.selector ? clipText(node.selector, MAX_SELECTOR_CHARS) : null,
    snippet: snippet ? clipText(snippet, MAX_SNIPPET_CHARS) : null,
    imageUrl: image?.url ?? null,
    imageUrlTruncated: image?.truncated ?? false,
  };
}

function extractField(exp: LoadingExperience | undefined): FieldMetrics | null {
  if (!exp?.metrics) return null;
  const m = exp.metrics;
  const clsRaw = m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;

  const field: FieldMetrics = {
    scope: exp.origin_fallback ? 'origin' : 'url',
    lcp: toReading('lcp', m.LARGEST_CONTENTFUL_PAINT_MS?.percentile),
    // PSI reports field CLS multiplied by 100, so divide to get the real score.
    cls: toReading('cls', clsRaw === undefined ? undefined : clsRaw / 100),
    inp: toReading('inp', m.INTERACTION_TO_NEXT_PAINT?.percentile),
  };

  // An empty `metrics: {}` means "no data", same as a missing object.
  return field.lcp || field.cls || field.inp ? field : null;
}

export async function fetchDiagnostics(
  targetUrl: string,
  strategy: Strategy,
): Promise<DiagnosticResult> {
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (!apiKey) {
    console.error('PAGESPEED_API_KEY is not set');
    throw new PageSpeedError('The diagnostic service is not configured.');
  }

  const params = new URLSearchParams({
    url: targetUrl,
    key: apiKey,
    strategy, // 'mobile' | 'desktop', already validated by the action
    category: 'performance',
  });

  const res = await fetch(`${PSI_ENDPOINT}?${params}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(55_000),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as PageSpeedApiError | null;
    console.error('PSI API error', res.status, body?.error?.message); // never log the full URL (has the key)
    if (res.status === 429) {
      throw new PageSpeedError('Rate limit reached. Please try again shortly.');
    }
    if (res.status === 400) {
      throw new PageSpeedError(
        'Google could not analyze that URL. Check that it is publicly reachable.',
      );
    }
    throw new PageSpeedError('The PageSpeed service returned an error.');
  }

  // Compile-time assertion only; consider Zod once more fields are consumed.
  const json = (await res.json()) as PageSpeedApiResponse;
  const { lighthouseResult } = json;

  if (lighthouseResult.runtimeError) {
    throw new PageSpeedError(
      `Lighthouse could not complete the audit: ${lighthouseResult.runtimeError.message}`,
    );
  }

  const lab = extractLab(lighthouseResult.audits);
  const field = extractField(json.loadingExperience);

  // Partial data is fine (a page with no traffic has no field data), but zero data is an error.
  const hasAnything = lab.lcp || lab.cls || field?.lcp || field?.cls || field?.inp;
  if (!hasAnything) {
    throw new PageSpeedError('No Core Web Vitals data was available for this page.');
  }

  return {
    url: lighthouseResult.finalUrl,
    strategy,
    fetchedAt: lighthouseResult.fetchTime,
    lab,
    lcpElement: extractLcpElement(lighthouseResult.audits, lighthouseResult.finalUrl),
    field,
  };
}
