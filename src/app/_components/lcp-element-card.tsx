import type { ImageInfo } from '@/types/crawl';
import type { LcpElement } from '@/types/pagespeed';
import { dedupeBySrc, resolveLcp, type LcpStatus } from '@/lib/lcp-match';

// No 'use client' and no hooks: this is props -> markup, same as MetricCard.
// It imports lcp-match, which is a pure helper (no secrets), so pairing the measured
// node with the crawl uses the SAME function the Server Action uses for the prompt.

const STATUS_COPY: Record<LcpStatus, string> = {
  matched: 'Paired with a crawled <img> — this is the image the AI will treat as LCP.',
  'img-not-matched':
    'Lighthouse measured an image, but it is not in the raw HTML (often injected by JavaScript).',
  'not-an-img': 'The LCP element is not an <img> (text or a CSS background image).',
  unknown: 'Lighthouse did not report an LCP element for this run.',
};

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="grid gap-1 sm:grid-cols-[7rem_1fr] sm:items-start">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="break-all font-mono text-xs text-slate-800">{value}</dd>
    </div>
  );
}

interface LcpElementCardProps {
  element: LcpElement | null;
  /** Crawl images from the same run, used only to show whether pairing succeeded. */
  images: readonly ImageInfo[];
}

export function LcpElementCard({ element, images }: LcpElementCardProps) {
  const { context } = resolveLcp(element, dedupeBySrc(images));
  const matchedSrc =
    context.matchedImageIndex !== null ? (images[context.matchedImageIndex]?.src ?? null) : null;

  return (
    <article className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-900">LCP element</h3>
        <p className="mt-1 text-xs text-slate-500">
          Measured by Lighthouse on this device profile, not guessed from HTML order.
        </p>
        <p className="mt-2 text-sm text-slate-700">{STATUS_COPY[context.status]}</p>
        {context.matchedImageIndex !== null && (
          <p className="mt-1 text-xs text-slate-500">
            images[{context.matchedImageIndex}]
            {matchedSrc ? ` · ${matchedSrc}` : ''}
          </p>
        )}
      </div>

      {element && (
        <dl className="space-y-3 p-5">
          <Row label="Tag" value={element.tag} />
          <Row label="Label" value={element.nodeLabel} />
          <Row label="Selector" value={element.selector} />
          <Row
            label="Image URL"
            value={
              element.imageUrl
                ? `${element.imageUrl}${element.imageUrlTruncated ? '…' : ''}`
                : null
            }
          />
          {element.snippet && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Snippet
              </dt>
              {/* Text child, so React escapes it. Lighthouse captured this from a third-party page. */}
              <dd>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-800">
                  <code>{element.snippet}</code>
                </pre>
              </dd>
            </div>
          )}
        </dl>
      )}
    </article>
  );
}
