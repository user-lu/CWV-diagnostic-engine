import 'server-only';

import * as cheerio from 'cheerio';
import type { CrawlResult, ImageInfo, JsonLdBlock } from '@/types/crawl';
import { fetchHtml } from './safe-fetch';

// Everything returned from a Server Action is serialized to the browser,
// so we bound every collection and string to keep the payload predictable.
const MAX_IMAGES = 200;
const MAX_JSONLD_BLOCKS = 20;
const MAX_JSONLD_CHARS = 20_000;
const MAX_FIELD_CHARS = 300;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// Collapse whitespace so multi-line <h1> markup reads as one line.
function cleanText(value: string): string | null {
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? null : clip(text, MAX_FIELD_CHARS);
}

// `undefined` (attribute absent) -> null. An empty string is kept as '' (see ImageInfo).
function readAttr(value: string | undefined): string | null {
  return value === undefined ? null : clip(value, MAX_FIELD_CHARS);
}

function resolveSrc(src: string | undefined, baseUrl: string): string | null {
  const trimmed = src?.trim();
  if (!trimmed) return null;
  try {
    return clip(new URL(trimmed, baseUrl).toString(), MAX_FIELD_CHARS); // relative -> absolute
  } catch {
    return clip(trimmed, MAX_FIELD_CHARS);
  }
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export async function crawlPage(url: string): Promise<CrawlResult> {
  const { html, finalUrl } = await fetchHtml(url);

  // Cheerio parses the HTML string into a DOM on the server. It never executes scripts,
  // so a hostile page can't run code here. That also means it only sees the RAW HTML,
  // not content that client-side JavaScript adds later.
  const $ = cheerio.load(html);

  const imgEls = $('img').toArray();
  const images: ImageInfo[] = imgEls.slice(0, MAX_IMAGES).map((el) => {
    const img = $(el);
    return {
      src: resolveSrc(img.attr('src'), finalUrl),
      width: readAttr(img.attr('width')),
      height: readAttr(img.attr('height')),
      alt: readAttr(img.attr('alt')),
      loading: readAttr(img.attr('loading')),
    };
  });

  const jsonLd: JsonLdBlock[] = $('script[type="application/ld+json" i]')
    .toArray()
    .slice(0, MAX_JSONLD_BLOCKS)
    .map((el) => {
      // .html() returns the raw script body. (.text()'s handling of <script> content has
      // varied between Cheerio versions, so .html() is the safe choice.)
      const raw = ($(el).html() ?? '').trim();
      return {
        raw: clip(raw, MAX_JSONLD_CHARS),
        isValidJson: isValidJson(raw),
        truncated: raw.length > MAX_JSONLD_CHARS,
      };
    });

  return {
    finalUrl,
    fetchedAt: new Date().toISOString(),
    title: cleanText($('title').first().text()),
    h1: cleanText($('h1').first().text()),
    images,
    imageCount: imgEls.length,
    jsonLd,
  };
}
