import type { CrawlState, ImageInfo, JsonLdBlock } from '@/types/crawl';

// No hooks and no 'use client': pure props -> markup. <details> gives us collapsible
// JSON-LD blocks with native browser behavior, so no useState is needed.
// (Same Tailwind rule as before: class names are complete static strings.)

const CARD = 'rounded-xl border border-slate-200 bg-white shadow-sm';

// Absent title/h1/alt are real SEO and accessibility defects, so they're flagged in orange.
function Missing() {
  return <span className="font-medium text-orange-600">Missing</span>;
}

function Dash() {
  return <span className="text-slate-400">—</span>;
}

function TextCard({ label, value }: { label: string; value: string | null }) {
  return (
    <div className={`${CARD} p-5`}>
      <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
      <p className="mt-2 break-words text-sm text-slate-700">{value ?? <Missing />}</p>
    </div>
  );
}

function ImagesCard({ images, total }: { images: readonly ImageInfo[]; total: number }) {
  const missingAlt = images.filter((i) => i.alt === null).length;
  // Images without width AND height reserve no space while loading, a classic cause of CLS.
  const missingDims = images.filter((i) => i.width === null || i.height === null).length;

  return (
    <div className={CARD}>
      <div className="border-b border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-900">
          Images <span className="ml-1 font-normal text-slate-500">({total})</span>
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          {missingAlt} missing alt · {missingDims} missing width/height (can cause layout shift)
        </p>
        {images.length < total && (
          <p className="mt-1 text-xs text-orange-600">
            Showing the first {images.length} of {total} images; counts above cover those only.
          </p>
        )}
      </div>

      {images.length === 0 ? (
        <p className="p-5 text-sm text-slate-500">No &lt;img&gt; tags found in the raw HTML.</p>
      ) : (
        // Fixed max height + sticky header keeps a 200-row table from dominating the page.
        <div className="max-h-96 overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Source</th>
                <th scope="col" className="px-4 py-2 font-medium">Width</th>
                <th scope="col" className="px-4 py-2 font-medium">Height</th>
                <th scope="col" className="px-4 py-2 font-medium">Alt</th>
                <th scope="col" className="px-4 py-2 font-medium">Loading</th>
              </tr>
            </thead>
            <tbody>
              {images.map((img, i) => (
                // Index key is fine: this list is static per render, never reordered.
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="max-w-xs break-all px-4 py-2 font-mono text-xs text-slate-700">
                    {img.src ?? <Missing />}
                  </td>
                  <td className="px-4 py-2 text-slate-700">{img.width ?? <Dash />}</td>
                  <td className="px-4 py-2 text-slate-700">{img.height ?? <Dash />}</td>
                  <td className="px-4 py-2 text-slate-700">
                    {img.alt === null ? (
                      <Missing />
                    ) : img.alt === '' ? (
                      <span className="text-slate-400">(empty, decorative)</span>
                    ) : (
                      img.alt
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-700">{img.loading ?? <Dash />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Minified JSON-LD is unreadable, so pretty-print when it's complete, valid JSON.
function formatJson(block: JsonLdBlock): string {
  if (!block.isValidJson || block.truncated) return block.raw;
  try {
    return JSON.stringify(JSON.parse(block.raw), null, 2);
  } catch {
    return block.raw;
  }
}

function JsonLdCard({ blocks }: { blocks: readonly JsonLdBlock[] }) {
  return (
    <div className={CARD}>
      <div className="p-5">
        <h3 className="text-sm font-semibold text-slate-900">
          Structured data (JSON-LD){' '}
          <span className="ml-1 font-normal text-slate-500">({blocks.length})</span>
        </h3>
      </div>

      {blocks.length === 0 ? (
        <p className="border-t border-slate-100 p-5 text-sm text-slate-500">
          No JSON-LD structured data found.
        </p>
      ) : (
        blocks.map((block, i) => (
          <details key={i} className="border-t border-slate-100">
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3 text-sm text-slate-700 hover:bg-slate-50">
              <span>Block {i + 1}</span>
              <span
                className={
                  block.isValidJson
                    ? 'rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20'
                    : 'rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/20'
                }
              >
                {block.isValidJson ? 'Valid JSON' : 'Invalid JSON'}
              </span>
            </summary>
            {/* React escapes text children, so crawled content can't inject markup (no XSS).
                Never feed crawled strings to dangerouslySetInnerHTML. */}
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all bg-slate-50 px-5 py-3 text-xs text-slate-800">
              {formatJson(block)}
            </pre>
            {block.truncated && (
              <p className="px-5 pb-3 text-xs text-orange-600">Block truncated for display.</p>
            )}
          </details>
        ))
      )}
    </div>
  );
}

export function CrawlSection({ state }: { state: CrawlState }) {
  if (state.status === 'idle') return null;

  if (state.status === 'error') {
    return (
      <p
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
      >
        Page structure: {state.message}
      </p>
    );
  }

  const { data } = state; // narrowed by the status check above
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Page structure</h2>
        <p className="text-sm text-slate-500">
          Parsed from the raw HTML the server receives. Content added later by JavaScript
          isn&apos;t included.
        </p>
        <p className="mt-1 truncate text-xs text-slate-500" title={data.finalUrl}>
          Crawled {data.finalUrl}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextCard label="Title" value={data.title} />
        <TextCard label="First H1" value={data.h1} />
      </div>

      <ImagesCard images={data.images} total={data.imageCount} />
      <JsonLdCard blocks={data.jsonLd} />
    </section>
  );
}

export function CrawlSkeleton() {
  return (
    <div role="status" className="animate-pulse space-y-4">
      <span className="sr-only">Reading page structure.</span>
      <div className="space-y-2">
        <div className="h-5 w-36 rounded bg-slate-200" />
        <div className="h-3 w-72 rounded bg-slate-200" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-24 rounded-xl border border-slate-200 bg-white shadow-sm" />
        <div className="h-24 rounded-xl border border-slate-200 bg-white shadow-sm" />
      </div>
      <div className="h-56 rounded-xl border border-slate-200 bg-white shadow-sm" />
    </div>
  );
}
