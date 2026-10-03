'use client';

import { useActionState } from 'react';
import { generateFixes } from '@/app/remediation-actions';
import { describeActionFailure } from '@/lib/rate-limit-message';
import type { CrawlResult } from '@/types/crawl';
import type { LcpElement } from '@/types/pagespeed';
import type { RemediationInput, RemediationState } from '@/types/remediation';
import { ActionableFixes, FixesSkeleton } from './actionable-fixes';
import { Spinner } from './spinner';

const initialState: RemediationState = { status: 'idle' };

// Send only what the model needs. The full CrawlResult carries up to ~400 KB of JSON-LD
// that would bloat the POST body and the prompt for no benefit.
function toRemediationInput(crawl: CrawlResult, lcpElement: LcpElement | null): RemediationInput {
  return {
    finalUrl: crawl.finalUrl,
    lcpElement, // measured by Lighthouse; null if the PageSpeed half failed or reported none
    title: crawl.title,
    h1: crawl.h1,
    imageCount: crawl.imageCount,
    images: crawl.images,
  };
}

interface RemediationPanelProps {
  crawl: CrawlResult;
  /** The element Lighthouse measured as LCP, or null when unavailable. */
  lcpElement: LcpElement | null;
}

export function RemediationPanel({ crawl, lcpElement }: RemediationPanelProps) {
  const input = toRemediationInput(crawl, lcpElement);

  // VANILLA JS vs REACT: vanilla would be click -> try { await fetch() } catch { show the
  // error in this card }, so one failed request can't blank the page. The proxy's 429 never
  // reaches the Server Action, so this client wrapper is that catch. useActionState turns
  // the result into (state, isPending) and React re-renders this section only.
  //
  // The parent renders this component with a `key` derived from the crawl, so a new crawl
  // remounts it: old fixes disappear and the closure picks up the fresh crawl.
  async function generateSafely(): Promise<RemediationState> {
    try {
      return await generateFixes(input);
    } catch (err) {
      return { status: 'error', message: describeActionFailure(err) };
    }
  }

  const [state, formAction, isPending] = useActionState(generateSafely, initialState);

  const hasImages = crawl.images.length > 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Actionable fixes</h2>
          <p className="text-sm text-slate-500">
            AI-generated from the raw HTML plus the Lighthouse-measured LCP element. Review every
            snippet before shipping it.
          </p>
        </div>

        {hasImages && (
          // On-demand, not automatic: each click is a paid LLM call.
          <form action={formAction}>
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex h-[38px] items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending && <Spinner />}
              {isPending ? 'Generating…' : state.status === 'idle' ? 'Generate fixes' : 'Regenerate'}
            </button>
          </form>
        )}
      </div>

      {!hasImages && (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          No images were found in the raw HTML, so there is nothing to analyze.
        </p>
      )}

      {/* isPending first: `state` still holds the previous result while a new run is in flight. */}
      {isPending ? (
        <FixesSkeleton />
      ) : (
        <div aria-live="polite">
          {state.status === 'error' && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {state.message}
            </p>
          )}
          {state.status === 'success' && (
            <ActionableFixes recommendations={state.recommendations} dropped={state.dropped} />
          )}
        </div>
      )}
    </section>
  );
}
