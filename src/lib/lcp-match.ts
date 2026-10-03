// Pure helpers (no secrets, no Node-only APIs, no runtime imports) that pair the LCP element
// Lighthouse MEASURED with the <img> tags the crawler FOUND. Kept apart from remediation.ts so
// the matching can be unit-tested without an OpenAI key.
import type { RemediationInput } from '@/types/remediation';

export type CrawledImage = RemediationInput['images'][number];
export type LcpElementInput = NonNullable<RemediationInput['lcpElement']>;

export interface PromptImage extends CrawledImage {
  /** Index in the ORIGINAL crawl list, so "images[N]" always matches the page's DOM order. */
  index: number;
  /** How many later <img> tags used the same src and were merged into this one. */
  duplicateCount: number;
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Collapse images that share a src (logos and icons are often repeated) into one entry.
 * Done in code rather than only in the prompt: a rule the model "should" follow is a
 * request, a loop is a guarantee, and fewer rows also means fewer tokens.
 */
export function dedupeBySrc(images: readonly CrawledImage[]): PromptImage[] {
  const bySrc = new Map<string, PromptImage>();
  const unique: PromptImage[] = [];

  images.forEach((img, index) => {
    const key = img.src?.split('#')[0] ?? null;
    const existing = key === null ? undefined : bySrc.get(key);
    if (existing) {
      existing.duplicateCount += 1;
      return;
    }
    const entry: PromptImage = { index, ...img, duplicateCount: 0 };
    unique.push(entry);
    if (key !== null) bySrc.set(key, entry);
  });

  return unique;
}

// There is deliberately NO DOM-order fallback: if the measured LCP element can't be paired with
// a crawled <img>, the model is told so and must not guess.
export type LcpStatus = 'matched' | 'img-not-matched' | 'not-an-img' | 'unknown';

export interface LcpContext {
  status: LcpStatus;
  /** Index into the ORIGINAL crawl list; non-null only when status is 'matched'. */
  matchedImageIndex: number | null;
  /** What Lighthouse measured, so the model can reason about non-image LCPs. */
  element: {
    tag: string | null;
    nodeLabel: string | null;
    selector: string | null;
    snippet: string | null;
  } | null;
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function withoutHash(url: URL): string {
  const copy = new URL(url.href);
  copy.hash = '';
  return copy.href;
}

/**
 * Find the crawled image that is the same resource as the LCP image URL.
 *
 * Pass 1 needs the same URL (query included). Pass 2 relaxes to origin + path, because the
 * crawler and Lighthouse are two separate requests: a locale or cache-busting query string
 * (e.g. ?hl=de after a geo redirect) can differ while the file is the same. Pass 2 only
 * accepts an UNAMBIGUOUS match: two different images sharing one path means we can't tell.
 *
 * Either side can be clipped with a trailing "…": the crawler clips srcs over 300 chars, and
 * Lighthouse clips long attribute values in its snippet (`targetTruncated`). A clipped value is
 * only a prefix, so it matches by prefix, and only when exactly one image fits (a short prefix
 * shared by several images proves nothing).
 */
export function findMatchingImage(
  images: readonly PromptImage[],
  imageUrl: string,
  targetTruncated = false,
): PromptImage | null {
  const target = parseHttpUrl(imageUrl);
  if (!target) return null;
  const targetHref = withoutHash(target);

  const candidates = images.flatMap((img) => {
    if (!img.src) return [];
    const truncated = img.src.endsWith('…');
    const raw = truncated ? img.src.slice(0, -1) : img.src;
    const url = truncated ? null : parseHttpUrl(raw);
    return [{ img, truncated, raw, href: url ? withoutHash(url) : null, url }];
  });

  const only = <T>(list: readonly T[]): T | null => (list.length === 1 ? list[0] : null);

  if (!targetTruncated) {
    const exact = candidates.filter((c) =>
      c.truncated ? targetHref.startsWith(c.raw) : c.href === targetHref,
    );
    // Identical srcs were already merged by dedupeBySrc, so >1 here means distinct clipped ones.
    if (exact.length > 0) return only(exact)?.img ?? null;
  } else {
    // Lighthouse gave us just the start of the URL: find the image(s) that begin with it.
    const prefixed = candidates.filter((c) =>
      c.truncated ? c.raw.startsWith(targetHref) || targetHref.startsWith(c.raw) : c.href?.startsWith(targetHref),
    );
    if (prefixed.length > 0) return only(prefixed)?.img ?? null;
  }

  // Pass 2 (full URLs only): same file, different query string.
  if (targetTruncated) return null;
  const samePath = candidates.filter(
    (c) => c.url !== null && c.url.origin + c.url.pathname === target.origin + target.pathname,
  );
  return only(samePath)?.img ?? null;
}

const MEDIA_TAGS = new Set(['img', 'video', 'image', 'source']);

export function resolveLcp(
  lcp: LcpElementInput | null,
  images: readonly PromptImage[],
): { context: LcpContext; matched: PromptImage | null } {
  if (lcp === null) {
    return { context: { status: 'unknown', matchedImageIndex: null, element: null }, matched: null };
  }

  const element = {
    tag: lcp.tag,
    nodeLabel: lcp.nodeLabel && clip(lcp.nodeLabel, 160),
    selector: lcp.selector && clip(lcp.selector, 200),
    snippet: lcp.snippet && clip(lcp.snippet, 300),
  };

  const matched = lcp.imageUrl
    ? findMatchingImage(images, lcp.imageUrl, lcp.imageUrlTruncated)
    : null;
  if (matched) {
    return { context: { status: 'matched', matchedImageIndex: matched.index, element }, matched };
  }

  // Not matched: say WHY, because "an image we couldn't pair" and "not an image at all"
  // lead to different advice.
  const isImageLike = lcp.imageUrl !== null || (lcp.tag !== null && MEDIA_TAGS.has(lcp.tag));
  const status: LcpStatus = isImageLike ? 'img-not-matched' : 'not-an-img';
  return { context: { status, matchedImageIndex: null, element }, matched: null };
}
