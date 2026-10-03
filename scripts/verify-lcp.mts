/**
 * Fixture checks for LCP extraction + crawl pairing. No API keys.
 *   node --experimental-strip-types --conditions=react-server scripts/verify-lcp.mts
 */
import { extractLcpElement } from '../src/lib/pagespeed.ts';
import { dedupeBySrc, resolveLcp } from '../src/lib/lcp-match.ts';
import type { PageSpeedApiResponse } from '../src/types/pagespeed.ts';

type Audits = PageSpeedApiResponse['lighthouseResult']['audits'];

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const BASE = 'https://web.dev/';

// Lighthouse <= 12: table row wrapping { node }.
const lh12: Audits = {
  'largest-contentful-paint-element': {
    id: 'largest-contentful-paint-element',
    title: 'LCP element',
    score: null,
    scoreDisplayMode: 'informative',
    details: {
      type: 'list',
      items: [
        {
          type: 'table',
          items: [
            {
              node: {
                type: 'node',
                selector: 'div.hero > img',
                snippet: '<img src="/static/images/home-blue.png" alt="">',
                nodeLabel: 'home-blue.png',
              },
            },
          ],
        },
      ],
    },
  },
};

// Lighthouse 13+: node listed next to a phase-timing table.
const lh13: Audits = {
  'lcp-breakdown-insight': {
    id: 'lcp-breakdown-insight',
    title: 'LCP breakdown',
    score: null,
    scoreDisplayMode: 'informative',
    details: {
      type: 'list',
      items: [
        { type: 'table', headings: [], items: [{ subpart: 'timeToFirstByte', duration: 100 }] },
        {
          type: 'node',
          selector: 'img.hero',
          snippet: '<img src="https://cdn.example.com/hero.jpg?v=1" class="hero">',
          nodeLabel: 'Hero',
        },
      ],
    },
  },
};

const discovery: Audits = {
  'lcp-discovery-insight': {
    id: 'lcp-discovery-insight',
    title: 'LCP discovery',
    score: null,
    scoreDisplayMode: 'informative',
    details: {
      type: 'list',
      items: [
        {
          type: 'node',
          selector: 'h1',
          snippet: '<h1>Welcome</h1>',
          nodeLabel: 'Welcome',
        },
      ],
    },
  },
};

const truncated: Audits = {
  'largest-contentful-paint-element': {
    id: 'largest-contentful-paint-element',
    title: 'LCP element',
    score: null,
    scoreDisplayMode: 'informative',
    details: {
      type: 'list',
      items: [
        {
          node: {
            selector: 'img',
            snippet: '<img src="https://cdn.example.com/very-long/path/hero.pn…">',
          },
        },
      ],
    },
  },
};

const from12 = extractLcpElement(lh12, BASE);
assert(from12?.tag === 'img', `lh12 tag: ${from12?.tag}`);
assert(from12?.imageUrl === 'https://web.dev/static/images/home-blue.png', `lh12 url: ${from12?.imageUrl}`);
assert(from12?.imageUrlTruncated === false, 'lh12 should not be truncated');
assert(from12?.nodeLabel === 'home-blue.png', `lh12 label: ${from12?.nodeLabel}`);

const from13 = extractLcpElement(lh13, BASE);
assert(from13?.tag === 'img', `lh13 tag: ${from13?.tag}`);
assert(from13?.imageUrl === 'https://cdn.example.com/hero.jpg?v=1', `lh13 url: ${from13?.imageUrl}`);

const textLcp = extractLcpElement(discovery, BASE);
assert(textLcp?.tag === 'h1', `discovery tag: ${textLcp?.tag}`);
assert(textLcp?.imageUrl === null, 'text LCP must not invent an image URL');

const clipped = extractLcpElement(truncated, BASE);
assert(clipped?.imageUrlTruncated === true, 'ellipsis in src must set truncated');
assert(
  clipped?.imageUrl === 'https://cdn.example.com/very-long/path/hero.pn',
  `truncated url: ${clipped?.imageUrl}`,
);

const images = dedupeBySrc([
  { src: 'https://web.dev/logo.svg', width: null, height: null, alt: 'logo', loading: null },
  { src: 'https://web.dev/logo.svg', width: null, height: null, alt: 'logo', loading: null },
  { src: 'https://web.dev/static/images/home-blue.png', width: null, height: null, alt: '', loading: null },
  { src: 'https://cdn.example.com/hero.jpg?hl=de', width: null, height: null, alt: '', loading: 'lazy' },
]);
assert(images.length === 3, `dedupe should collapse the logo, got ${images.length}`);
assert(images[0].duplicateCount === 1, 'logo should record one duplicate');
assert(images[1].index === 2, `home-blue should keep original index 2, got ${images[1].index}`);

const matched = resolveLcp(from12, images);
assert(matched.context.status === 'matched', `expected matched, got ${matched.context.status}`);
assert(matched.context.matchedImageIndex === 2, `expected index 2, got ${matched.context.matchedImageIndex}`);

const queryDiff = resolveLcp(from13, images);
assert(queryDiff.context.status === 'matched', `query-diff should match by path, got ${queryDiff.context.status}`);
assert(queryDiff.context.matchedImageIndex === 3, `hero should be original index 3, got ${queryDiff.context.matchedImageIndex}`);

const notImg = resolveLcp(textLcp, images);
assert(notImg.context.status === 'not-an-img', `expected not-an-img, got ${notImg.context.status}`);
assert(notImg.context.matchedImageIndex === null, 'text LCP must not pick an image');

const unknown = resolveLcp(null, images);
assert(unknown.context.status === 'unknown', `expected unknown, got ${unknown.context.status}`);

const prefix = resolveLcp(clipped, [
  {
    index: 0,
    src: 'https://cdn.example.com/very-long/path/hero.png',
    width: null,
    height: null,
    alt: '',
    loading: null,
    duplicateCount: 0,
  },
]);
assert(prefix.context.status === 'matched', `truncated prefix should match, got ${prefix.context.status}`);

console.log('verify-lcp: all fixtures passed');
